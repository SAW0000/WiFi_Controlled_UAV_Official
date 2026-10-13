#include "esp_camera.h"
#include <WiFi.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <esp_random.h>
#include <new>
#include <freertos/semphr.h>
#include "board_config.h"
#include "camera_pins.h"
#include "auth.h"
#include <WebSocketsServer.h>
#define PPM_FRAME_LENGTH 22500
#define PPM_PULSE_LENGTH 300
#define PPM_CHANNELS 8
#define PPM_VALUE_MIN 800
#define PPM_VALUE_MAX 2200
#define PPM_SYNC_MIN_US 3000
static_assert(PPM_CHANNELS * PPM_VALUE_MAX < PPM_FRAME_LENGTH, "PPM channels at max would overrun the frame (sync gap <= 0)");
static_assert(PPM_FRAME_LENGTH - (PPM_CHANNELS * PPM_VALUE_MAX + PPM_PULSE_LENGTH) >= PPM_SYNC_MIN_US,
              "PPM sync gap with every channel at max is shorter than PPM_SYNC_MIN_US");
static_assert(PPM_VALUE_MIN > PPM_PULSE_LENGTH, "PPM_VALUE_MIN must exceed PPM_PULSE_LENGTH (channel fill would be <= 0)");
#define DEFAULT_CHANNEL_VALUE 1500
#define OUTPUT_PIN 14
#define FLASH_LED_PIN LED_GPIO_NUM

const char *default_ap_ssid = "UAV-Settings";
const char *default_ap_password = "UAVAPPASSWORD";
const char *default_wifi_ssid = "UAV";
const char *default_wifi_password = "UAVPROJECT1";
const char *default_hostname = "UAV1";
const int default_websocket_port = 82;

char wifi_ssid[32];
char wifi_password[32];
char hostname[32];
char ap_ssid[32];
char ap_password[32];
int websocket_port;

char device_password[32];
char csrf_token[17];

SemaphoreHandle_t settings_mutex = NULL;
struct SettingsLock {
  SettingsLock() { if (settings_mutex) xSemaphoreTake(settings_mutex, portMAX_DELAY); }
  ~SettingsLock() { if (settings_mutex) xSemaphoreGive(settings_mutex); }
};

void snapshotSetting(char *dst, const char *src, size_t size) {
  SettingsLock lock;
  memcpy(dst, src, size);
}

bool ap_enabled = true;
volatile bool ap_active = false;
IPAddress ap_ip;
bool wifi_connected = false;

DNSServer dnsServer;
const byte DNS_PORT = 53;

WebServer server(80);

uint16_t FailSafeValues[4] = {
  1500,
  1500,
  885,
  1500,
};

uint16_t channelValue[PPM_CHANNELS] = {
  1500,
  1500,
  885,
  1500,
  1500,
  1500,
  1500,
  1500
};

hw_timer_t *timer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

volatile bool ppm_output_enabled = false;

bool camera_ok = false;

enum ppmState_e
{
    PPM_STATE_IDLE,
    PPM_STATE_PULSE,
    PPM_STATE_FILL,
    PPM_STATE_SYNC
};

void IRAM_ATTR onPpmTimer()
{
    static uint8_t ppmState = PPM_STATE_IDLE;
    static uint8_t ppmChannel = 0;
    static uint8_t ppmOutput = LOW;
    static int usedFrameLength = 0;
    int currentChannelValue;

    portENTER_CRITICAL(&timerMux);

    if (ppmState == PPM_STATE_IDLE)
    {
        if (!ppm_output_enabled)
        {
            ppmOutput = LOW;
            timerAlarm(timer, PPM_FRAME_LENGTH, true, 0);
            portEXIT_CRITICAL(&timerMux);
            digitalWrite(OUTPUT_PIN, ppmOutput);
            return;
        }
        ppmState = PPM_STATE_PULSE;
        ppmChannel = 0;
        usedFrameLength = 0;
        ppmOutput = LOW;
    }

    if (ppmState == PPM_STATE_PULSE)
    {
        ppmOutput = HIGH;
        usedFrameLength += PPM_PULSE_LENGTH;
        ppmState = (ppmChannel >= PPM_CHANNELS) ? PPM_STATE_SYNC : PPM_STATE_FILL;
        timerAlarm(timer, PPM_PULSE_LENGTH, true, 0);
    }
    else if (ppmState == PPM_STATE_FILL)
    {
        ppmOutput = LOW;
        currentChannelValue = channelValue[ppmChannel];
        if (currentChannelValue < PPM_VALUE_MIN) currentChannelValue = PPM_VALUE_MIN;
        else if (currentChannelValue > PPM_VALUE_MAX) currentChannelValue = PPM_VALUE_MAX;

        ppmChannel++;
        ppmState = PPM_STATE_PULSE;
        usedFrameLength += currentChannelValue - PPM_PULSE_LENGTH;
        timerAlarm(timer, currentChannelValue - PPM_PULSE_LENGTH, true, 0);
    }
    else if (ppmState == PPM_STATE_SYNC)
    {
        ppmOutput = LOW;
        ppmState = PPM_STATE_IDLE;
        timerAlarm(timer, PPM_FRAME_LENGTH - usedFrameLength, true, 0);
        usedFrameLength = 0;
    }
    portEXIT_CRITICAL(&timerMux);
    digitalWrite(OUTPUT_PIN, ppmOutput);
}

void setPpmOutput(bool enabled) {
  if (ppm_output_enabled == enabled) return;
  ppm_output_enabled = enabled;
  if (enabled) {
    Serial.println("Stick command from the control UI: PPM output to the flight controller started");
  } else {
    Serial.println("FAIL-SAFE: no pilot connected - PPM output stopped, the flight controller sees a signal loss");
  }
}

const uint16_t WEBSOCKET_INITIAL_PORT = 82;
WebSocketsServer webSocket(WEBSOCKET_INITIAL_PORT);

uint16_t current_websocket_port = WEBSOCKET_INITIAL_PORT;
volatile uint16_t pending_websocket_port = WEBSOCKET_INITIAL_PORT;
volatile bool websocket_restart_requested = false;
volatile bool device_password_changed = false;

IPAddress clientIPs[WEBSOCKETS_SERVER_CLIENT_MAX];

bool ws_authenticated[WEBSOCKETS_SERVER_CLIENT_MAX] = {false};

bool ws_pilot[WEBSOCKETS_SERVER_CLIENT_MAX] = {false};

int findClientByIP(IPAddress ip) {
  for (int i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    if (webSocket.clientIsConnected(i) && clientIPs[i] == ip) {
      return i;
    }
  }
  return -1;
}

unsigned long clientLastActivity[WEBSOCKETS_SERVER_CLIENT_MAX] = {0};

void resetClientSlot(int i) {
  ws_authenticated[i] = false;
  ws_pilot[i] = false;
  clientLastActivity[i] = 0;
  clientIPs[i] = IPAddress(0, 0, 0, 0);
}

const unsigned long CLIENT_TIMEOUT = 4000;
const unsigned long CLIENT_PING_AFTER_MS = 2000;
const unsigned long STALE_CHECK_INTERVAL_MS = 1000;
const uint32_t WS_HEARTBEAT_PING_MS = 2000;
const uint32_t WS_HEARTBEAT_PONG_TIMEOUT_MS = 1000;
const uint8_t WS_HEARTBEAT_MISS_COUNT = 2;

void checkStaleConnections() {
  unsigned long currentTime = millis();
  
  for (int i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    if (webSocket.clientIsConnected(i)) {
      if (!ws_authenticated[i] && clientLastActivity[i] == 0) {
        clientLastActivity[i] = currentTime;
      }
      if (currentTime - clientLastActivity[i] > CLIENT_TIMEOUT) {
        Serial.printf("Client %d connection timed out (inactive for %u ms). Disconnecting.\n", 
                     i, (currentTime - clientLastActivity[i]));
        webSocket.disconnect(i);
      }
      else {
        if (currentTime - clientLastActivity[i] > CLIENT_PING_AFTER_MS) {
          webSocket.sendPing(i);
          Serial.printf("Sending ping to client %d to verify connection\n", i);
        }
      }
    }
  }
}
void checkAndActivateFailSafe() {
  int connectedPilots = 0;
  for (int i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    if (webSocket.clientIsConnected(i) && ws_authenticated[i] && ws_pilot[i]) {
      connectedPilots++;
    }
  }

  if (connectedPilots == 0 && ppm_output_enabled) {
    for (int i = 0; i < 4; i++) {
      channelValue[i] = FailSafeValues[i];
    }
    Serial.printf("Fail-safe stick values set: roll %u, pitch %u, throttle %u, yaw %u\n",
                  FailSafeValues[0], FailSafeValues[1], FailSafeValues[2], FailSafeValues[3]);
    setPpmOutput(false);
  }
}

void showConnectedClients() {
  int connectedClients = 0;
  Serial.println("\n=== Connected WebSocket Clients ===");
  
  for (int i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    if (webSocket.clientIsConnected(i)) {
      IPAddress ip = clientIPs[i];
      Serial.printf("Client %d: %d.%d.%d.%d\n", i, ip[0], ip[1], ip[2], ip[3]);
      connectedClients++;
    }
  }
  
  if (connectedClients == 0) {
    Serial.println("No clients connected");
  }
  
  Serial.printf("Total clients: %d\n", connectedClients);
  Serial.println("===================================\n");
}

bool secureEquals(const char *a, size_t aLen, const char *b, size_t bLen) {
  size_t n = aLen > bLen ? aLen : bLen;
  uint8_t diff = (aLen != bLen) ? 1 : 0;
  for (size_t i = 0; i < n; i++) {
    uint8_t ca = (i < aLen) ? (uint8_t)a[i] : 0;
    uint8_t cb = (i < bLen) ? (uint8_t)b[i] : 0;
    diff |= (uint8_t)(ca ^ cb);
  }
  return diff == 0;
}

int hexNibbleValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool extractWsToken(const uint8_t *payload, size_t length, char *out, size_t outSize, size_t *outLen) {
  if (payload == NULL || outSize == 0) return false;
  const char *url = (const char *)payload;
  size_t pos = 0;
  while (pos < length && url[pos] != '?') pos++;
  if (pos >= length) return false;
  pos++;

  const char key[] = "token=";
  const size_t keyLen = sizeof(key) - 1;
  while (pos < length) {
    size_t end = pos;
    while (end < length && url[end] != '&') end++;
    if (end - pos >= keyLen && strncmp(url + pos, key, keyLen) == 0) {
      size_t n = 0;
      for (size_t i = pos + keyLen; i < end; i++) {
        char c = url[i];
        if (c == '%') {
          if (i + 2 >= end) return false;
          int hi = hexNibbleValue(url[i + 1]);
          int lo = hexNibbleValue(url[i + 2]);
          if (hi < 0 || lo < 0) return false;
          c = (char)((hi << 4) | lo);
          i += 2;
        }
        if (n + 1 >= outSize) return false;
        out[n++] = c;
      }
      out[n] = '\0';
      *outLen = n;
      return true;
    }
    pos = end + 1;
  }
  return false;
}

bool devicePasswordMatches(const char *s, size_t len) {
  char password[sizeof(device_password)];
  snapshotSetting(password, device_password, sizeof(password));
  password[sizeof(password) - 1] = '\0';
  size_t passwordLen = strlen(password);
  if (s == NULL || passwordLen == 0) return false;
  return secureEquals(s, len, password, passwordLen);
}

const uint8_t AUTH_MAX_FAILURES = 5;
const unsigned long AUTH_LOCKOUT_BASE_MS = 30000;
const unsigned long AUTH_LOCKOUT_MAX_MS = 300000;
const size_t AUTH_RECORD_COUNT = 8;

struct AuthRecord {
  bool inUse;
  uint32_t ip;
  uint8_t failures;
  uint8_t lockoutCount;
  bool locked;
  unsigned long lockedUntil;
  unsigned long lastFailure;
};

AuthRecord authRecords[AUTH_RECORD_COUNT];
portMUX_TYPE authMux = portMUX_INITIALIZER_UNLOCKED;

uint32_t authKeyFromIP(const IPAddress &ip) {
  if (ip.type() == IPv4) return (uint32_t)ip;
  for (int i = 0; i < 10; i++) {
    if (ip[i] != 0) return 0;
  }
  if (ip[10] != 0xff || ip[11] != 0xff) return 0;
  uint8_t tail[4] = {ip[12], ip[13], ip[14], ip[15]};
  uint32_t key;
  memcpy(&key, tail, sizeof(key));
  return key;
}

int findAuthRecordIndex(uint32_t ip) {
  for (size_t i = 0; i < AUTH_RECORD_COUNT; i++) {
    if (authRecords[i].inUse && authRecords[i].ip == ip) return (int)i;
  }
  return -1;
}

unsigned long authLockoutRemainingMs(uint32_t ip) {
  unsigned long now = millis();
  unsigned long remaining = 0;
  portENTER_CRITICAL(&authMux);
  int index = findAuthRecordIndex(ip);
  AuthRecord *r = (index >= 0) ? &authRecords[index] : NULL;
  if (r != NULL && r->locked) {
    long left = (long)(r->lockedUntil - now);
    if (left > 0) {
      remaining = (unsigned long)left;
    } else {
      r->locked = false;
    }
  }
  portEXIT_CRITICAL(&authMux);
  return remaining;
}

bool authIsLockedOut(uint32_t ip) {
  return authLockoutRemainingMs(ip) > 0;
}

void authRecordResult(uint32_t ip, bool ok) {
  unsigned long now = millis();
  unsigned long startedLockoutMs = 0;
  portENTER_CRITICAL(&authMux);
  int index = findAuthRecordIndex(ip);
  AuthRecord *r = (index >= 0) ? &authRecords[index] : NULL;
  if (ok) {
    if (r != NULL) r->inUse = false;
  } else {
    if (r == NULL) {
      AuthRecord *reuse = NULL;
      for (size_t i = 0; i < AUTH_RECORD_COUNT && reuse == NULL; i++) {
        if (!authRecords[i].inUse) reuse = &authRecords[i];
      }
      for (int pass = 0; pass < 2 && reuse == NULL; pass++) {
        for (size_t i = 0; i < AUTH_RECORD_COUNT; i++) {
          AuthRecord *c = &authRecords[i];
          bool lockedNow = c->locked && (long)(c->lockedUntil - now) > 0;
          if (pass == 0 && lockedNow) continue;
          if (reuse == NULL || (long)(c->lastFailure - reuse->lastFailure) < 0) reuse = c;
        }
      }
      r = reuse;
      r->inUse = true;
      r->ip = ip;
      r->failures = 0;
      r->lockoutCount = 0;
      r->locked = false;
    }
    bool lockedNow = r->locked && (long)(r->lockedUntil - now) > 0;
    r->lastFailure = now;
    if (!lockedNow) {
      r->locked = false;
      if (++r->failures >= AUTH_MAX_FAILURES) {
        unsigned long lockoutMs = AUTH_LOCKOUT_BASE_MS;
        for (uint8_t i = 0; i < r->lockoutCount && lockoutMs < AUTH_LOCKOUT_MAX_MS; i++) {
          lockoutMs *= 2;
        }
        if (lockoutMs > AUTH_LOCKOUT_MAX_MS) lockoutMs = AUTH_LOCKOUT_MAX_MS;
        r->failures = 0;
        if (r->lockoutCount < 255) r->lockoutCount++;
        r->locked = true;
        r->lockedUntil = now + lockoutMs;
        startedLockoutMs = lockoutMs;
      }
    }
  }
  portEXIT_CRITICAL(&authMux);

  if (startedLockoutMs > 0) {
    const uint8_t *b = (const uint8_t *)&ip;
    Serial.printf("Too many wrong passwords from %u.%u.%u.%u: locked out for %lu s\n",
                  b[0], b[1], b[2], b[3], startedLockoutMs / 1000);
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected!\n", num);
      resetClientSlot(num);
      checkAndActivateFailSafe();
      break;
    
    case WStype_CONNECTED:
      {
        ws_authenticated[num] = false;
        ws_pilot[num] = false;
        IPAddress ip = webSocket.remoteIP(num);
        uint32_t ipKey = authKeyFromIP(ip);

        if (authIsLockedOut(ipKey)) {
          Serial.printf("WebSocket client %u refused: locked out after too many wrong passwords\n", num);
          webSocket.sendTXT(num, "auth:locked");
          webSocket.disconnect(num);
          break;
        }

        char token[sizeof(device_password)];
        size_t tokenLen = 0;
        bool haveToken = extractWsToken(payload, length, token, sizeof(token), &tokenLen) && tokenLen > 0;
        bool tokenValid = haveToken && devicePasswordMatches(token, tokenLen);
        if (haveToken) {
          authRecordResult(ipKey, tokenValid);
        }

        if (tokenValid) {
          Serial.printf("[%u] Connection from %d.%d.%d.%d\n", num, ip[0], ip[1], ip[2], ip[3]);

          clientIPs[num] = ip;
          clientLastActivity[num] = millis();
          ws_authenticated[num] = true;
          webSocket.sendTXT(num, "auth:ok");
        } else {
          bool nowLocked = haveToken && authIsLockedOut(ipKey);
          Serial.printf("WebSocket client %u rejected: %s\n", num,
                        nowLocked ? "wrong token, now locked out" : "bad or missing token");
          webSocket.sendTXT(num, nowLocked ? "auth:locked" : "auth:failed");
          webSocket.disconnect(num);
        }
      }
      break;
    
    case WStype_TEXT:
      if (!ws_authenticated[num]) {
        Serial.printf("[%u] Ignoring message from unauthenticated client\n", num);
        break;
      }
      clientLastActivity[num] = millis();
      handleCommand(num, payload, length);
      break;
      
    case WStype_PING:
      Serial.printf("[%u] Received ping\n", num);
      clientLastActivity[num] = millis();
      break;
      
    case WStype_PONG:
      Serial.printf("[%u] Received pong\n", num);
      clientLastActivity[num] = millis();
      break;
  }
}

bool parseStrictInt(const char *s, size_t len, int *out) {
  size_t i = 0;
  bool negative = false;
  if (len > 0 && s[0] == '-') {
    negative = true;
    i = 1;
  }
  if (i >= len) return false;
  int value = 0;
  for (; i < len; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    value = value * 10 + (s[i] - '0');
    if (value > 100000) return false;
  }
  *out = negative ? -value : value;
  return true;
}

bool parseCommandFields(const char *msg, size_t length, int *a, int *x, int *y) {
  size_t colon[2] = {0, 0};
  size_t colons = 0;
  for (size_t i = 0; i < length; i++) {
    if (msg[i] == ':') {
      if (colons == 2) return false;
      colon[colons++] = i;
    }
  }
  if (colons != 2) return false;
  return parseStrictInt(msg, colon[0], a) &&
         parseStrictInt(msg + colon[0] + 1, colon[1] - colon[0] - 1, x) &&
         parseStrictInt(msg + colon[1] + 1, length - colon[1] - 1, y);
}

void handleCommand(uint8_t num, uint8_t * payload, size_t length) {
  const char *message = (const char *)payload;
  int A = 0, X = 0, Y = 0;

  if (!parseCommandFields(message, length, &A, &X, &Y)) {
    Serial.printf("Rejected command from client %u: malformed, expected A:X:Y with integer fields (got \"%.*s\")\n",
                  num, (int)(length < 32 ? length : 32), message);
    return;
  }

  const int failSafeCount = (int)(sizeof(FailSafeValues) / sizeof(FailSafeValues[0]));

  switch(A) {
    case 0:
      if (X < 0 || X >= failSafeCount) {
        Serial.printf("Rejected command: fail-safe channel %d out of range [0,%d]\n", X, failSafeCount - 1);
        return;
      }
      if (Y < PPM_VALUE_MIN || Y > PPM_VALUE_MAX) {
        Serial.printf("Rejected command: fail-safe channel %d value %d outside [%d,%d]\n",
                      X, Y, PPM_VALUE_MIN, PPM_VALUE_MAX);
        return;
      }
      FailSafeValues[X] = Y;
      Serial.printf("Fall safe channel %d value is %d\n", X, Y);
      break;
      
    case 1:
      if (X < 0 || X >= PPM_CHANNELS) {
        Serial.printf("Rejected command: channel %d out of range [0,%d]\n", X, PPM_CHANNELS - 1);
        return;
      }
      if (Y < PPM_VALUE_MIN || Y > PPM_VALUE_MAX) {
        Serial.printf("Rejected command: channel %d value %d outside [%d,%d]\n",
                      X, Y, PPM_VALUE_MIN, PPM_VALUE_MAX);
        return;
      }
      channelValue[X] = Y;
      Serial.printf("Channel number %d value is %d\n", X, Y);
      ws_pilot[num] = true;
      setPpmOutput(true);
      break;
      
    case 2:
      if (X == 0) {
        Serial.println("Landing Gear is Actived");
      }
      else if (X == 1) {
        Serial.println("Landing Gear is Pulled");
      }
      else {
        Serial.println("Wrong signal was sent to control the landing gears");
      }
      break;
      
    case 3:
      if (X == 0) {
        TurnLED(false);
        Serial.println("Flash LED is turned OFF");
      } 
      else if (X == 1) {
        TurnLED(true);
        Serial.println("Flash LED is turned ON");
      } 
      else {
        Serial.println("Wrong Signal Sent to Control The Flash LED");
      }
      break;
      
    default:
      Serial.printf("Unknown command: A=%d\n", A);
      break;
  }
}

void DisconnectAllWebSocketClients(){
  for (int i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    webSocket.disconnect(i);
  }
  Serial.println("All WebSocket clients disconnected");
}

void setLedManual(bool on);
void cameraRotateViewToken();

void TurnLED(bool state) {
  setLedManual(state);
  int duty = state ? 255 : 0;
  Serial.printf("LED manual switch %s (GPIO %d manual duty=%d)\n",
              state ? "ON" : "OFF",
              FLASH_LED_PIN,
              duty);
}

void startCameraServer();
void setupLedFlash(int pin);

const size_t SETTING_MAX_LEN = 31;
const size_t PASSWORD_MIN_LEN = 8;
const int WEBSOCKET_PORT_MIN = 1024;
const int WEBSOCKET_PORT_MAX = 65535;

const char SETTINGS_NVS_NAMESPACE[] = "uav";
const char NVS_KEY_WIFI_SSID[] = "wifi_ssid";
const char NVS_KEY_WIFI_PASSWORD[] = "wifi_password";
const char NVS_KEY_HOSTNAME[] = "hostname";
const char NVS_KEY_WEBSOCKET_PORT[] = "websocket_port";
const char NVS_KEY_AP_SSID[] = "ap_ssid";
const char NVS_KEY_AP_PASSWORD[] = "ap_password";
const char NVS_KEY_AP_ENABLED[] = "ap_enabled";
const char NVS_KEY_DEVICE_PASSWORD[] = "device_password";

void copySetting(char *dst, size_t size, const char *src) {
  strncpy(dst, src, size - 1);
  dst[size - 1] = '\0';
}

bool hasValidLength(const String &s, size_t minLen) {
  size_t len = s.length();
  return len >= minLen && len <= SETTING_MAX_LEN && strlen(s.c_str()) == len;
}

bool isValidSsid(const String &s) {
  return hasValidLength(s, 1);
}

bool isValidPassword(const String &s) {
  return hasValidLength(s, PASSWORD_MIN_LEN);
}

bool isValidDevicePassword(const String &s) {
  if (!hasValidLength(s, PASSWORD_MIN_LEN)) return false;
  for (size_t i = 0; i < s.length(); i++) {
    unsigned char c = (unsigned char)s.charAt(i);
    if (c < 0x21 || c > 0x7E) return false;
  }
  return true;
}

bool isValidHostname(const String &s) {
  size_t len = s.length();
  if (len < 1 || len > SETTING_MAX_LEN) return false;
  if (s.charAt(0) == '-' || s.charAt(len - 1) == '-') return false;
  for (size_t i = 0; i < len; i++) {
    char c = s.charAt(i);
    bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
    if (!ok) return false;
  }
  return true;
}

bool isValidWebSocketPort(int port) {
  if (port == 80 || port == DNS_PORT || port == CAMERA_STREAM_PORT || port == CAMERA_CONTROL_PORT) return false;
  if (port == default_websocket_port) return true;
  return port >= WEBSOCKET_PORT_MIN && port <= WEBSOCKET_PORT_MAX;
}

void restartWebSocketServer(uint16_t port) {
  Serial.printf("Changing WebSocket port from %d to %d\n", current_websocket_port, port);
  webSocket.close();
  delay(100);

  for (int i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    resetClientSlot(i);
  }

  webSocket.~WebSocketsServer();
  new (&webSocket) WebSocketsServer(port);
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  webSocket.enableHeartbeat(WS_HEARTBEAT_PING_MS, WS_HEARTBEAT_PONG_TIMEOUT_MS, WS_HEARTBEAT_MISS_COUNT);

  current_websocket_port = port;
  Serial.printf("WebSocket server restarted on port %d\n", port);

  checkAndActivateFailSafe();
}

void loadSettings() {
  Preferences prefs;
  if (!prefs.begin(SETTINGS_NVS_NAMESPACE, true)) {
    Serial.println("No saved settings, using defaults");
    return;
  }

  auto loadString = [&](const char *key, char *buf, size_t size, bool (*isValid)(const String &)) {
    if (!prefs.isKey(key)) return;
    String value = prefs.getString(key, "");
    if (isValid(value)) {
      copySetting(buf, size, value.c_str());
    } else {
      Serial.printf("Ignoring invalid saved setting '%s', using the default\n", key);
    }
  };
  loadString(NVS_KEY_WIFI_SSID, wifi_ssid, sizeof(wifi_ssid), isValidSsid);
  loadString(NVS_KEY_WIFI_PASSWORD, wifi_password, sizeof(wifi_password), isValidPassword);
  loadString(NVS_KEY_HOSTNAME, hostname, sizeof(hostname), isValidHostname);
  loadString(NVS_KEY_AP_SSID, ap_ssid, sizeof(ap_ssid), isValidSsid);
  loadString(NVS_KEY_AP_PASSWORD, ap_password, sizeof(ap_password), isValidPassword);
  loadString(NVS_KEY_DEVICE_PASSWORD, device_password, sizeof(device_password), isValidDevicePassword);

  if (prefs.isKey(NVS_KEY_WEBSOCKET_PORT)) {
    int port = prefs.getUShort(NVS_KEY_WEBSOCKET_PORT, 0);
    if (isValidWebSocketPort(port)) {
      websocket_port = port;
    } else {
      Serial.printf("Ignoring invalid saved setting '%s', using the default\n", NVS_KEY_WEBSOCKET_PORT);
    }
  }
  if (prefs.isKey(NVS_KEY_AP_ENABLED)) {
    ap_enabled = prefs.getBool(NVS_KEY_AP_ENABLED, ap_enabled);
  }
  prefs.end();

  Serial.printf("Settings: WiFi SSID \"%s\", hostname %s, WebSocket port %d, AP SSID \"%s\", AP %s\n",
                wifi_ssid, hostname, websocket_port, ap_ssid, ap_enabled ? "enabled" : "disabled");
}

bool saveStringSetting(Preferences &prefs, const char *key, const char *value) {
  if (prefs.isKey(key) && prefs.getString(key, "").equals(value)) return true;
  return prefs.putString(key, value) == strlen(value);
}

bool saveSettings() {
  Preferences prefs;
  if (!prefs.begin(SETTINGS_NVS_NAMESPACE, false)) {
    Serial.println("Could not open NVS: settings were applied but NOT saved");
    return false;
  }
  bool ok = true;
  ok &= saveStringSetting(prefs, NVS_KEY_WIFI_SSID, wifi_ssid);
  ok &= saveStringSetting(prefs, NVS_KEY_WIFI_PASSWORD, wifi_password);
  ok &= saveStringSetting(prefs, NVS_KEY_HOSTNAME, hostname);
  ok &= saveStringSetting(prefs, NVS_KEY_AP_SSID, ap_ssid);
  ok &= saveStringSetting(prefs, NVS_KEY_AP_PASSWORD, ap_password);
  ok &= saveStringSetting(prefs, NVS_KEY_DEVICE_PASSWORD, device_password);

  uint16_t port = (uint16_t)websocket_port;
  if (!prefs.isKey(NVS_KEY_WEBSOCKET_PORT) || prefs.getUShort(NVS_KEY_WEBSOCKET_PORT, 0) != port) {
    ok &= (prefs.putUShort(NVS_KEY_WEBSOCKET_PORT, port) == sizeof(uint16_t));
  }
  if (!prefs.isKey(NVS_KEY_AP_ENABLED) || prefs.getBool(NVS_KEY_AP_ENABLED, !ap_enabled) != ap_enabled) {
    ok &= (prefs.putBool(NVS_KEY_AP_ENABLED, ap_enabled) == sizeof(uint8_t));
  }
  prefs.end();
  Serial.println(ok ? "Settings saved" : "Settings applied but NOT all of them could be saved: they are lost at the next reboot");
  return ok;
}

void initDevicePassword() {
  if (device_password[0] == '\0') {
    if (isValidDevicePassword(ap_password)) {
      copySetting(device_password, sizeof(device_password), ap_password);
    } else {
      copySetting(device_password, sizeof(device_password), default_ap_password);
      Serial.println("The AP password cannot be used as the device password (spaces or non-ASCII characters)");
    }
    Preferences prefs;
    if (prefs.begin(SETTINGS_NVS_NAMESPACE, false)) {
      bool saved = saveStringSetting(prefs, NVS_KEY_DEVICE_PASSWORD, device_password);
      prefs.end();
      if (saved) {
        Serial.println("No saved device password: it was set from the AP password and saved");
      } else {
        Serial.println("Could not write the device password to NVS: it will be derived again at the next boot");
      }
    } else {
      Serial.println("Could not open NVS: device password not saved, it will be derived again at the next boot");
    }
  }
  if (strcmp(device_password, default_ap_password) == 0) {
    Serial.println("WARNING: the device password is still the default - change it on the settings page");
  }
}

void generateCsrfToken() {
  snprintf(csrf_token, sizeof(csrf_token), "%08x%08x", (unsigned int)esp_random(), (unsigned int)esp_random());
}

void factoryReset() {
  Preferences prefs;
  if (!prefs.begin(SETTINGS_NVS_NAMESPACE, false)) {
    Serial.println("Factory reset failed: could not open NVS");
    return;
  }
  bool cleared = prefs.clear();
  prefs.end();
  if (!cleared) {
    Serial.println("Factory reset failed: could not clear the saved settings");
    return;
  }
  Serial.println("Factory reset: all saved settings and the device password were erased. Restarting...");
  Serial.flush();
  delay(100);
  ESP.restart();
}

const size_t SERIAL_LINE_MAX = 64;

void handleSerialConsole() {
  static char line[SERIAL_LINE_MAX + 1];
  static size_t lineLen = 0;
  static bool tooLong = false;

  while (Serial.available() > 0) {
    int c = Serial.read();
    if (c < 0) break;
    if (c != '\n' && c != '\r') {
      if (lineLen < SERIAL_LINE_MAX) {
        line[lineLen++] = (char)c;
      } else {
        tooLong = true;
      }
      continue;
    }

    size_t len = lineLen;
    bool discard = tooLong;
    lineLen = 0;
    tooLong = false;
    if (discard) {
      Serial.println("Serial command too long, ignored");
      continue;
    }
    line[len] = '\0';
    char *cmd = line;
    while (*cmd == ' ' || *cmd == '\t') cmd++;
    size_t cmdLen = strlen(cmd);
    while (cmdLen > 0 && (cmd[cmdLen - 1] == ' ' || cmd[cmdLen - 1] == '\t')) cmd[--cmdLen] = '\0';
    if (cmdLen == 0) continue;

    if (strcmp(cmd, "factory-reset") == 0) {
      factoryReset();
    } else {
      Serial.println("Unknown command. Available: factory-reset");
    }
  }
}

String htmlEscape(const String &in) {
  String out;
  out.reserve(in.length() + 16);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in.charAt(i);
    switch (c) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      case '"': out += "&quot;"; break;
      case '\'': out += "&#39;"; break;
      case '%': out += "&#37;"; break;
      default: out += c; break;
    }
  }
  return out;
}

const char SETTINGS_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>UAV Configuration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: #f9f9f9;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        h1 {
            text-align: center;
            color: #333;
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input[type="text"], input[type="password"], input[type="number"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 15px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            width: 100%;
        }
        button:hover {
            background-color: #45a049;
        }
        .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 4px;
        }
        .status-ok {
            background-color: #d4edda;
            color: #155724;
        }
        .status-error {
            background-color: #f8d7da;
            color: #721c24;
        }
        .warning {
            color: #856404;
            background-color: #fff3cd;
            padding: 10px;
            border-radius: 4px;
            margin-top: 15px;
            text-align: center;
            font-weight: bold;
        }
        .danger {
            color: #721c24;
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 15px;
            text-align: center;
            font-weight: bold;
        }
        .link-button {
            display: block;
            text-align: center;
            margin-top: 20px;
            padding: 10px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>UAV Configuration</h1>
        %DEFAULT_PASSWORD_WARNING%
        <form action="/save-settings" method="post">
            <input type="hidden" name="csrf_token" value="%CSRF%">
            <div class="form-group">
                <label for="wifi_ssid">WiFi SSID:</label>
                <input type="text" id="wifi_ssid" name="wifi_ssid" value="%WIFI_SSID%">
            </div>
            
            <div class="form-group">
                <label for="wifi_password">WiFi Password:</label>
                <input type="password" id="wifi_password" name="wifi_password" placeholder="(unchanged)" autocomplete="new-password">
            </div>
            
            <div class="form-group">
                <label for="hostname">Hostname (DNS):</label>
                <input type="text" id="hostname" name="hostname" value="%HOSTNAME%">
            </div>
            
            <div class="form-group">
                <label for="websocket_port">WebSocket Port:</label>
                <input type="number" id="websocket_port" name="websocket_port" value="%WEBSOCKET_PORT%">
            </div>
            
            <div class="form-group">
                <label for="ap_ssid">ESP32 AP SSID:</label>
                <input type="text" id="ap_ssid" name="ap_ssid" value="%AP_SSID%">
            </div>
            
            <div class="form-group">
                <label for="ap_password">ESP32 AP Password:</label>
                <input type="password" id="ap_password" name="ap_password" placeholder="(unchanged)" autocomplete="new-password">
            </div>
            
            <div class="form-group">
                <label for="device_password">Device Password (admin login and control token):</label>
                <input type="password" id="device_password" name="device_password" placeholder="(unchanged)" autocomplete="new-password">
            </div>

            <div class="form-group">
                <label for="ap_enabled">Access Point Status:</label>
                <select id="ap_enabled" name="ap_enabled">
                    <option value="1" %AP_ENABLED_SELECTED_TRUE%>Enabled</option>
                    <option value="0" %AP_ENABLED_SELECTED_FALSE%>Disabled</option>
                </select>
            </div>
            
            <div class="warning">
                يجب الغاء تفعيل الاكسيس بوينت بعد التأكد من مراجعه كل الإعدادات حفاظا على استهلاك الموارد
            </div>
            
            <div class="status %WIFI_STATUS_CLASS%">
                WiFi Connection State: %WIFI_STATUS%
            </div>
            
            <div class="status %AP_STATUS_CLASS%">
                AP State: %AP_STATUS%
            </div>

            <div class="status %CAMERA_STATUS_CLASS%">
                Camera: %CAMERA_STATUS%
            </div>

            <button type="submit">Save Settings</button>
        </form>

        %CAMERA_LINK%
    </div>
</body>
</html>
)rawliteral";

const char WAIT_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>Saving Settings</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            text-align: center;
        }
        .container {
            max-width: 500px;
            margin: 100px auto;
            padding: 20px;
            background-color: #f7f7f7;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
        }
        .spinner {
            margin: 30px auto;
            width: 50px;
            height: 50px;
            border: 5px solid rgba(0, 0, 0, 0.1);
            border-radius: 50%;
            border-top-color: #09f;
            animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        p {
            font-size: 18px;
            color: #555;
        }
    </style>
    <script>
        setTimeout(function() {
            window.location.href = '/';
        }, 3000);
    </script>
</head>
<body>
    <div class="container">
        <h1>Saving Settings</h1>
        <div class="spinner"></div>
        <p>Please wait while your settings are being applied...</p>
        <p>You will be redirected automatically.</p>
    </div>
</body>
</html>
)rawliteral";

bool refuseIfLockedOut(uint32_t ip) {
  unsigned long remainingMs = authLockoutRemainingMs(ip);
  if (remainingMs == 0) return false;
  unsigned long seconds = (remainingMs + 999) / 1000;
  server.sendHeader("Retry-After", String(seconds));
  server.send(429, "text/plain", "Too many wrong passwords. Try again in " + String(seconds) + " seconds.");
  return true;
}

bool requireAuth() {
  uint32_t ip = authKeyFromIP(server.client().remoteIP());
  if (refuseIfLockedOut(ip)) return false;

  char password[sizeof(device_password)];
  snapshotSetting(password, device_password, sizeof(password));
  if (password[0] != '\0' && server.authenticate("admin", password)) {
    authRecordResult(ip, true);
    return true;
  }
  if (server.hasHeader("Authorization")) {
    authRecordResult(ip, false);
    if (refuseIfLockedOut(ip)) return false;
  }
  server.requestAuthentication();
  return false;
}

bool csrfTokenMatches(const String &submitted) {
  size_t expectedLen = strlen(csrf_token);
  return expectedLen > 0 && secureEquals(submitted.c_str(), submitted.length(), csrf_token, expectedLen);
}

void handleRoot() {
  if (!requireAuth()) return;

  String html = SETTINGS_PAGE;

  char current_wifi_ssid[sizeof(wifi_ssid)];
  char current_hostname[sizeof(hostname)];
  char current_ap_ssid[sizeof(ap_ssid)];
  snapshotSetting(current_wifi_ssid, wifi_ssid, sizeof(current_wifi_ssid));
  snapshotSetting(current_hostname, hostname, sizeof(current_hostname));
  snapshotSetting(current_ap_ssid, ap_ssid, sizeof(current_ap_ssid));

  html.replace("%CSRF%", htmlEscape(csrf_token));

  char current_device_password[sizeof(device_password)];
  snapshotSetting(current_device_password, device_password, sizeof(current_device_password));
  current_device_password[sizeof(current_device_password) - 1] = '\0';
  if (strcmp(current_device_password, default_ap_password) == 0) {
    html.replace("%DEFAULT_PASSWORD_WARNING%",
                 "<div class=\"danger\">The device password is still the factory default. "
                 "Change it below (Device Password) before flying.</div>");
  } else {
    html.replace("%DEFAULT_PASSWORD_WARNING%", "");
  }
  memset(current_device_password, 0, sizeof(current_device_password));

  html.replace("%WIFI_SSID%", htmlEscape(current_wifi_ssid));
  html.replace("%HOSTNAME%", htmlEscape(current_hostname));
  html.replace("%WEBSOCKET_PORT%", htmlEscape(String(websocket_port)));
  html.replace("%AP_SSID%", htmlEscape(current_ap_ssid));

  if (ap_enabled) {
    html.replace("%AP_ENABLED_SELECTED_TRUE%", "selected");
    html.replace("%AP_ENABLED_SELECTED_FALSE%", "");
  } else {
    html.replace("%AP_ENABLED_SELECTED_TRUE%", "");
    html.replace("%AP_ENABLED_SELECTED_FALSE%", "selected");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    html.replace("%WIFI_STATUS%", htmlEscape("Connected to " + String(current_wifi_ssid) + " (" + WiFi.localIP().toString() + ")"));
    html.replace("%WIFI_STATUS_CLASS%", "status-ok");
  } else {
    html.replace("%WIFI_STATUS%", "Disconnected");
    html.replace("%WIFI_STATUS_CLASS%", "status-error");
  }
  
  if (ap_active) {
    String apStatus = "Enabled (" + ap_ip.toString() + ")";
    if (!ap_enabled) apStatus += " - kept on until the WiFi connects, because it is saved as disabled";
    html.replace("%AP_STATUS%", htmlEscape(apStatus));
    html.replace("%AP_STATUS_CLASS%", "status-ok");
  } else {
    html.replace("%AP_STATUS%", "Disabled");
    html.replace("%AP_STATUS_CLASS%", "status-error");
  }
  
  if (camera_ok) {
    html.replace("%CAMERA_STATUS%", "Running");
    html.replace("%CAMERA_STATUS_CLASS%", "status-ok");

    String cameraUrl;
    const String cameraPort = ":" + String(CAMERA_CONTROL_PORT);
    IPAddress clientIP = server.client().remoteIP();
    IPAddress apIP = WiFi.softAPIP();

    if (clientIP[0] == apIP[0] && clientIP[1] == apIP[1] && clientIP[2] == apIP[2]) {
      cameraUrl = "http://" + WiFi.softAPIP().toString() + cameraPort;
      Serial.println("Client connected via AP, camera URL: " + cameraUrl);
    } else if (WiFi.status() == WL_CONNECTED) {
      cameraUrl = "http://" + String(current_hostname) + ".local" + cameraPort;
      Serial.println("Client connected via network, camera URL: " + cameraUrl);
    } else {
      cameraUrl = "http://" + WiFi.softAPIP().toString() + cameraPort;
      Serial.println("Using fallback camera URL: " + cameraUrl);
    }

    html.replace("%CAMERA_LINK%", "<a href=\"" + htmlEscape(cameraUrl) + "\" class=\"link-button\">Go to Camera Settings</a>");
  } else {
    html.replace("%CAMERA_STATUS%", "not detected (no video; check the camera ribbon cable and restart)");
    html.replace("%CAMERA_STATUS_CLASS%", "status-error");
    html.replace("%CAMERA_LINK%", "");
  }

  server.send(200, "text/html", html);
}

struct SettingsParams {
  String wifi_ssid;
  String wifi_password;
  String hostname;
  String ap_ssid;
  String ap_password;
  String device_password;
  int websocket_port;
  bool ap_enabled;
};

volatile bool settings_apply_running = false;

void applySettingsTask(void *parameter) {
  SettingsParams* params = (SettingsParams*)parameter;
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

  if (strcmp(wifi_ssid, params->wifi_ssid.c_str()) != 0 ||
      strcmp(wifi_password, params->wifi_password.c_str()) != 0) {

    {
      SettingsLock lock;
      copySetting(wifi_ssid, sizeof(wifi_ssid), params->wifi_ssid.c_str());
      copySetting(wifi_password, sizeof(wifi_password), params->wifi_password.c_str());
    }

    WiFi.disconnect();
    delay(100);
    WiFi.begin(params->wifi_ssid.c_str(), params->wifi_password.c_str());

    for (int i = 0; i < 10 && WiFi.status() != WL_CONNECTED; i++) {
      delay(100);
    }
  }

  if (strcmp(hostname, params->hostname.c_str()) != 0) {
    {
      SettingsLock lock;
      copySetting(hostname, sizeof(hostname), params->hostname.c_str());
    }
    WiFi.setHostname(params->hostname.c_str());
    if (MDNS.begin(params->hostname.c_str())) {
      Serial.printf("mDNS responder started with hostname: %s.local\n", params->hostname.c_str());
    }
  }

  bool want_ap = params->ap_enabled || WiFi.status() != WL_CONNECTED;
  if (strcmp(ap_ssid, params->ap_ssid.c_str()) != 0 ||
      strcmp(ap_password, params->ap_password.c_str()) != 0 ||
      want_ap != ap_active) {

    {
      SettingsLock lock;
      copySetting(ap_ssid, sizeof(ap_ssid), params->ap_ssid.c_str());
      copySetting(ap_password, sizeof(ap_password), params->ap_password.c_str());
    }

    WiFi.softAPdisconnect(true);
    delay(100);

    if (want_ap) {
      WiFi.softAP(params->ap_ssid.c_str(), params->ap_password.c_str());
      ap_active = true;
      Serial.printf("AP enabled with SSID: %s\n", params->ap_ssid.c_str());
    } else {
      ap_active = false;
      Serial.println("AP disabled");
    }
    if (!params->ap_enabled && want_ap) {
      Serial.println("AP stays on: it is saved as disabled but the station WiFi is not connected");
    }
  }
  ap_enabled = params->ap_enabled;

  if (strcmp(device_password, params->device_password.c_str()) != 0) {
    {
      SettingsLock lock;
      copySetting(device_password, sizeof(device_password), params->device_password.c_str());
    }
    device_password_changed = true;
    Serial.println("Device password change applied");
  }

  if (params->websocket_port != websocket_port) {
    websocket_port = params->websocket_port;
    pending_websocket_port = (uint16_t)websocket_port;
    websocket_restart_requested = true;
    Serial.printf("WebSocket port change to %d requested\n", websocket_port);
  }

  saveSettings();

  delete params;
  settings_apply_running = false;

  vTaskDelete(NULL);
}

void sendSettingsErrorPage(const String &message, int status) {
  String html = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">"
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                "<title>Invalid Settings</title></head>"
                "<body style=\"font-family: Arial, sans-serif; padding: 20px;\">"
                "<h1>Settings not saved</h1><p>";
  html += htmlEscape(message);
  html += "</p><p>No settings were changed.</p>"
          "<p><a href=\"/\" onclick=\"history.back(); return false;\">Go back</a></p>"
          "</body></html>";
  server.send(status, "text/html", html);
}

void sendSettingsError(const String &message) {
  sendSettingsErrorPage(message, 400);
}

void sendFormExpired() {
  String html = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">"
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                "<title>Form Expired</title></head>"
                "<body style=\"font-family: Arial, sans-serif; padding: 20px;\">"
                "<h1>Settings not saved</h1><p>";
  html += htmlEscape("Form expired - reload the settings page and try again.");
  html += "</p><p><a href=\"/\">Reload the settings page</a></p>"
          "</body></html>";
  server.send(403, "text/html", html);
}

void handleSaveSettings() {
  if (!requireAuth()) return;
  if (!csrfTokenMatches(server.arg("csrf_token"))) {
    sendFormExpired();
    return;
  }

  String new_wifi_ssid = server.arg("wifi_ssid");
  String new_wifi_password = server.arg("wifi_password");
  String new_hostname = server.arg("hostname");
  String new_websocket_port_str = server.arg("websocket_port");
  String new_ap_ssid = server.arg("ap_ssid");
  String new_ap_password = server.arg("ap_password");
  String new_device_password = server.arg("device_password");
  String new_ap_enabled_str = server.arg("ap_enabled");
  
  if (!isValidSsid(new_wifi_ssid)) {
    sendSettingsError("WiFi SSID must be 1 to 31 characters.");
    return;
  }
  if (new_wifi_password.length() > 0 && !isValidPassword(new_wifi_password)) {
    sendSettingsError("WiFi password must be 8 to 31 characters (leave it empty to keep the current one).");
    return;
  }
  if (!isValidHostname(new_hostname)) {
    sendSettingsError("Hostname must be 1 to 31 characters: letters, digits and hyphens only, not starting or ending with a hyphen.");
    return;
  }
  int new_websocket_port = 0;
  if (!parseStrictInt(new_websocket_port_str.c_str(), new_websocket_port_str.length(), &new_websocket_port) ||
      !isValidWebSocketPort(new_websocket_port)) {
    sendSettingsError("WebSocket port must be a number from 1024 to 65535 (or the default, 82).");
    return;
  }
  if (!isValidSsid(new_ap_ssid)) {
    sendSettingsError("ESP32 AP SSID must be 1 to 31 characters.");
    return;
  }
  if (new_ap_password.length() > 0 && !isValidPassword(new_ap_password)) {
    sendSettingsError("ESP32 AP password must be 8 to 31 characters (leave it empty to keep the current one).");
    return;
  }
  if (new_device_password.length() > 0 && !isValidDevicePassword(new_device_password)) {
    sendSettingsError("Device password must be 8 to 31 printable ASCII characters without spaces (leave it empty to keep the current one).");
    return;
  }
  if (!new_ap_enabled_str.equals("0") && !new_ap_enabled_str.equals("1")) {
    sendSettingsError("Access Point Status must be Enabled or Disabled.");
    return;
  }
  bool new_ap_enabled = new_ap_enabled_str.equals("1");

  if (settings_apply_running) {
    sendSettingsErrorPage("The previous settings change is still being applied. Wait a few seconds and try again.", 503);
    return;
  }

  char kept_wifi_password[sizeof(wifi_password)];
  char kept_ap_password[sizeof(ap_password)];
  char kept_device_password[sizeof(device_password)];
  snapshotSetting(kept_wifi_password, wifi_password, sizeof(kept_wifi_password));
  snapshotSetting(kept_ap_password, ap_password, sizeof(kept_ap_password));
  snapshotSetting(kept_device_password, device_password, sizeof(kept_device_password));
  if (new_wifi_password.length() == 0) new_wifi_password = kept_wifi_password;
  if (new_ap_password.length() == 0) new_ap_password = kept_ap_password;
  if (new_device_password.length() == 0) new_device_password = kept_device_password;

  SettingsParams* params = new SettingsParams{
    new_wifi_ssid,
    new_wifi_password,
    new_hostname,
    new_ap_ssid,
    new_ap_password,
    new_device_password,
    new_websocket_port,
    new_ap_enabled
  };

  TaskHandle_t apply_task = NULL;
  settings_apply_running = true;
  if (xTaskCreate(
    applySettingsTask,
    "ApplySettings",
    8192,
    params,
    1,
    &apply_task
  ) != pdPASS) {
    Serial.println("Could not start the settings task: settings not applied");
    delete params;
    settings_apply_running = false;
    sendSettingsErrorPage("The device is out of memory and could not start applying the settings. Try again.", 500);
    return;
  }

  server.send(200, "text/html", WAIT_PAGE);
  xTaskNotifyGive(apply_task);
}

void setup() {
  settings_mutex = xSemaphoreCreateMutex();

  copySetting(wifi_ssid, sizeof(wifi_ssid), default_wifi_ssid);
  copySetting(wifi_password, sizeof(wifi_password), default_wifi_password);
  copySetting(hostname, sizeof(hostname), default_hostname);
  copySetting(ap_ssid, sizeof(ap_ssid), default_ap_ssid);
  copySetting(ap_password, sizeof(ap_password), default_ap_password);
  websocket_port = default_websocket_port;
  device_password[0] = '\0';
  
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();

  loadSettings();

  initDevicePassword();
  Serial.println("Type factory-reset on this serial console to reset settings and the device password");

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  pinMode(OUTPUT_PIN, OUTPUT);
  
  timer = timerBegin(1000000);
  timerAttachInterrupt(timer, &onPpmTimer);
  timerAlarm(timer, 12000, true, 0);
  timerStart(timer);

  camera_config_t config;
  config.ledc_channel = CAMERA_XCLK_LEDC_CHANNEL;
  config.ledc_timer = CAMERA_XCLK_LEDC_TIMER;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_UXGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  if (config.pixel_format == PIXFORMAT_JPEG) {
    if (psramFound()) {
      config.jpeg_quality = 10;
      config.fb_count = 2;
      config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
      config.frame_size = FRAMESIZE_SVGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  } else {
    config.frame_size = FRAMESIZE_240X240;
#if CONFIG_IDF_TARGET_ESP32S3
    config.fb_count = 2;
#endif
  }

#if defined(CAMERA_MODEL_ESP_EYE)
  pinMode(13, INPUT_PULLUP);
  pinMode(14, INPUT_PULLUP);
#endif

  esp_err_t err = esp_camera_init(&config);
  camera_ok = (err == ESP_OK);
  if (!camera_ok) {
    Serial.printf("Camera init failed with error 0x%x: continuing without the camera (no video, no camera page)\n", err);
  }

  setupLedFlash(FLASH_LED_PIN);
  ledcWrite(FLASH_LED_PIN, 0);

  sensor_t *s = camera_ok ? esp_camera_sensor_get() : NULL;
  if (s != NULL) {
    if (s->id.PID == OV3660_PID) {
      s->set_vflip(s, 1);
      s->set_brightness(s, 1);
      s->set_saturation(s, -2);
    }
    if (config.pixel_format == PIXFORMAT_JPEG) {
      s->set_framesize(s, FRAMESIZE_QVGA);
    }

#if defined(CAMERA_MODEL_M5STACK_WIDE) || defined(CAMERA_MODEL_M5STACK_ESP32CAM)
    s->set_vflip(s, 1);
    s->set_hmirror(s, 1);
#endif

#if defined(CAMERA_MODEL_ESP32S3_EYE)
    s->set_vflip(s, 1);
#endif
  }

  WiFi.softAP(ap_ssid, ap_password);
  ap_active = true;
  ap_ip = WiFi.softAPIP();
  Serial.print("AP IP address: ");
  Serial.println(ap_ip);

  WiFi.begin(wifi_ssid, wifi_password);
  WiFi.setSleep(false);
  WiFi.setHostname(hostname);

  unsigned long startAttemptTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 5000) {
    delay(100);
    Serial.print(".");
    yield();
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("WiFi connected");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    wifi_connected = true;
    
    if (MDNS.begin(hostname)) {
      Serial.printf("mDNS responder started, hostname: %s.local\n", hostname);
    } else {
      Serial.println("Error setting up mDNS responder!");
    }
  } else {
    Serial.println("");
    Serial.println("WiFi connection failed");
    wifi_connected = false;
  }
  
  if (!ap_enabled) {
    if (wifi_connected) {
      WiFi.softAPdisconnect(true);
      ap_active = false;
      Serial.println("AP disabled (saved setting)");
    } else {
      Serial.println("WiFi not connected: keeping the AP on so the settings page stays reachable");
    }
  }

  dnsServer.start(DNS_PORT, "*", ap_ip);
  
  generateCsrfToken();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/save-settings", HTTP_POST, handleSaveSettings);

  const char *collectedHeaders[] = {"Authorization"};
  server.collectHeaders(collectedHeaders, sizeof(collectedHeaders) / sizeof(collectedHeaders[0]));

  server.begin();
  Serial.println("Web server started");

  if (websocket_port != current_websocket_port) {
    restartWebSocketServer((uint16_t)websocket_port);
  } else {
    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
    webSocket.enableHeartbeat(WS_HEARTBEAT_PING_MS, WS_HEARTBEAT_PONG_TIMEOUT_MS, WS_HEARTBEAT_MISS_COUNT);
  }
  Serial.println("WebSocket server started with heartbeat mechanism");

  if (camera_ok) {
    startCameraServer();
  } else {
    Serial.println("Camera servers not started: the camera failed to initialise");
  }

  Serial.println("PPM output waits for the control UI's first stick command (arming or the test panel)");

  Serial.println("System Ready!");
  if (wifi_connected) {
    Serial.print("Use 'http://");
    Serial.print(WiFi.localIP());
    Serial.println("' to connect");
    
    Serial.print("Or use hostname: http://");
    Serial.print(hostname);
    Serial.println(".local");
  }
  
  if (ap_active) {
    Serial.print("For settings, use: http://");
    Serial.println(ap_ip);
  } else {
    Serial.println("The AP is off: open the settings page through the station WiFi address above");
  }
}

void loop() {
  yield();

  handleSerialConsole();
  dnsServer.processNextRequest();
  server.handleClient();

  if (device_password_changed) {
    device_password_changed = false;
    DisconnectAllWebSocketClients();
    cameraRotateViewToken();
  }

  if (websocket_restart_requested) {
    websocket_restart_requested = false;
    uint16_t port = pending_websocket_port;
    if (port != current_websocket_port) {
      restartWebSocketServer(port);
    }
  }
  webSocket.loop();
  
  static unsigned long lastClientCheck = 0;
  if (millis() - lastClientCheck > 10000) {
    lastClientCheck = millis();
    checkAndActivateFailSafe();
    
    yield();
  }
  
  static unsigned long lastStaleCheck = 0;
  if (millis() - lastStaleCheck > STALE_CHECK_INTERVAL_MS) {
    lastStaleCheck = millis();
    checkStaleConnections();
    
    yield();
  }
  
  static unsigned long lastWifiCheck = 0;
  if (millis() - lastWifiCheck > 30000) {
    lastWifiCheck = millis();
    wifi_connected = (WiFi.status() == WL_CONNECTED);
    
    if (wifi_connected) {
      Serial.print("WiFi connected. IP: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("WiFi disconnected. Will attempt reconnection.");
      char ssid[sizeof(wifi_ssid)];
      char password[sizeof(wifi_password)];
      snapshotSetting(ssid, wifi_ssid, sizeof(ssid));
      snapshotSetting(password, wifi_password, sizeof(password));
      WiFi.begin(ssid, password);
    }
    
    yield();
  }
  
  delay(10);
}