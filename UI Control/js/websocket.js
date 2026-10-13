
let socket = null;

let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 10;
const RECONNECTION_DELAY_MS = 500;
const AUTH_REPLY_TIMEOUT_MS = 5000;
let reconnectionTimer = null;

const LOCKOUT_RETRY_MS = 30000;
let lockoutRetryTimer = null;

let savedControlState = 0;
let wasControlEnabled = false;

const VIEW_ONLY_STREAM_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMDAwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIiBmaWxsPSIjZTk0NTYwIj7ZieG1juKAjdiw2Kcg2YXYtNin2YfYr9ipINmB2YLYt9iMINmE2Kcg2YrZiNis2K8g2KrYrdmD2YU8L3RleHQ+PC9zdmc+";

const FAILSAFE_SLIDER_IDS = ['failsafeRollSlider', 'failsafePitchSlider', 'failsafeThrottleSlider', 'failsafeYawSlider'];

let lastFailedStreamSrc = null;

function initializeWebSocket() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن الاتصال في وضع المشاهدة', '⚠️', 'warning', 'connection');
    return;
  }
  
  const ipAddress = document.getElementById('ipAddressInput').value;
  const wsPort = document.getElementById('wsPortInput').value;
  const wsToken = document.getElementById('wsTokenInput').value.trim();
  
  updateConnectionStatus('connecting');
  
  try {
    if (reconnectionTimer) {
      clearTimeout(reconnectionTimer);
      reconnectionTimer = null;
    }
    if (lockoutRetryTimer) {
      clearTimeout(lockoutRetryTimer);
      lockoutRetryTimer = null;
    }

    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    
    socket = new WebSocket(`ws://${ipAddress}:${wsPort}/?token=${encodeURIComponent(wsToken)}`);
    
    let authenticated = false;
    let authRejected = false;
    let authTimer = null;
    const thisSocket = socket;

    socket.onopen = () => {
      console.log('WebSocket open, waiting for the device to accept the access token');
      authTimer = setTimeout(() => {
        authTimer = null;
        if (thisSocket === socket && !authenticated && !authRejected) {
          authRejected = true;
          showNotification('لم يؤكد الجهاز رمز الوصول، تأكد من أن البرنامج الثابت محدّث', '⚠️', 'error', 'websocket');
          thisSocket.close();
        }
      }, AUTH_REPLY_TIMEOUT_MS);
    };

    socket.onclose = (event) => {
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
      console.log('WebSocket disconnected, code:', event.code);
      wsConnected = false;
      updateConnectionStatus('disconnected');

      if (authenticated) {
        savedControlState = controlState;
        wasControlEnabled = controlsEnabled;
        console.log('Saved control state:', savedControlState);
      }

      if (controlsEnabled) {
        disableControls();
      }

      if (authRejected) {
        reconnectionAttempts = 0;
        return;
      }

      attemptReconnection();
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error');
      wsConnected = false;
      updateConnectionStatus('disconnected');
      showNotification('خطأ في الاتصال بالويب سوكت', '⚠️', 'error', 'websocket');
      
    };
    
    socket.onmessage = (event) => {
      if (event.data === 'auth:ok') {
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
        authenticated = true;
        console.log('WebSocket connected');
        wsConnected = true;
        updateConnectionStatus('connected');
        showNotification('تم الاتصال بالويب سوكت', '✅', 'success', 'websocket');

        reconnectionAttempts = 0;

        sendFailsafeValues();
        
        if (wasControlEnabled && savedControlState > 0) {
          console.log('Restoring previous control state:', savedControlState);
          setTimeout(() => {
            if (savedControlState === 1) {
              controlState = 0;
              cycleControlState({ resume: true });
            }
            else if (savedControlState === 2) {
              controlState = 0;
              cycleControlState({ resume: true });
              setTimeout(() => {
                cycleControlState();
              }, 500);
            }
          }, 1000);
        }
        return;
      }
      if (event.data === 'auth:failed') {
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
        authRejected = true;
        showNotification('رمز الوصول غير صحيح، تحقق من كلمة مرور الجهاز في الإعدادات', '🔒', 'error', 'websocket');
        return;
      }
      if (event.data === 'auth:locked') {
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
        authRejected = true;
        showNotification('محاولات خاطئة كثيرة لكلمة مرور الجهاز، تم إيقاف الاتصال مؤقتاً. ستتم إعادة المحاولة تلقائياً بعد 30 ثانية', '🔒', 'error', 'websocket');
        if (lockoutRetryTimer) {
          clearTimeout(lockoutRetryTimer);
        }
        lockoutRetryTimer = setTimeout(() => {
          lockoutRetryTimer = null;
          if (!isViewOnlyMode) {
            initializeWebSocket();
          }
        }, LOCKOUT_RETRY_MS);
        return;
      }
      console.log('Message from server:', event.data);
    };
  } catch (e) {
    console.error('Error initializing WebSocket:', e);
    wsConnected = false;
    updateConnectionStatus('disconnected');
    showNotification('خطأ في تهيئة الويب سوكت', '⚠️', 'error', 'websocket');
    
    attemptReconnection();
  }
}

function attemptReconnection() {
  if (isViewOnlyMode) {
    return;
  }
  
  if (reconnectionAttempts < MAX_RECONNECTION_ATTEMPTS) {
    reconnectionAttempts++;
    
    updateConnectionStatus('connecting');
    showNotification(`جاري إعادة الاتصال (${reconnectionAttempts}/${MAX_RECONNECTION_ATTEMPTS})`, '🔄', 'warning', 'websocket');
    
    const delayTime = Math.min(RECONNECTION_DELAY_MS * reconnectionAttempts, 3000);
    
    reconnectionTimer = setTimeout(() => {
      console.log(`Attempting reconnection ${reconnectionAttempts}/${MAX_RECONNECTION_ATTEMPTS}`);
      initializeWebSocket();
    }, delayTime);
  } else {
    showNotification('فشل في إعادة الاتصال بعد عدة محاولات', '❌', 'error', 'websocket');
    
    reconnectionAttempts = 0;
  }
}

function closeWebSocketQuietly() {
  if (reconnectionTimer) {
    clearTimeout(reconnectionTimer);
    reconnectionTimer = null;
  }
  if (lockoutRetryTimer) {
    clearTimeout(lockoutRetryTimer);
    lockoutRetryTimer = null;
  }
  reconnectionAttempts = 0;

  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.onerror = null;
    socket.close();
  }
}

function sendFailsafeValue(channel) {
  if (!wsConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  
  const value = readInputInRange(FAILSAFE_SLIDER_IDS[channel]);
  if (isNaN(value)) {
    console.warn(`Fail-safe value for channel ${channel} not sent: out of range`);
    return;
  }
  
  socket.send(`0:${channel}:${value}`);
}

const FAILSAFE_SEND_DEBOUNCE_MS = 200;
const failsafeSendTimers = {};

function scheduleFailsafeValueSend(channel) {
  if (failsafeSendTimers[channel]) {
    clearTimeout(failsafeSendTimers[channel]);
  }
  failsafeSendTimers[channel] = setTimeout(() => {
    delete failsafeSendTimers[channel];
    sendFailsafeValue(channel);
  }, FAILSAFE_SEND_DEBOUNCE_MS);
}

function sendFailsafeValues() {
  for (let channel = 0; channel < FAILSAFE_SLIDER_IDS.length; channel++) {
    sendFailsafeValue(channel);
  }
}

function buildTokenStreamUrl(streamUrl) {
  const token = document.getElementById('wsTokenInput').value.trim();
  try {
    const url = new URL(streamUrl.trim());
    url.searchParams.set('token', token);
    return url.toString();
  } catch (e) {
    showNotification('رابط البث غير صالح، تم استخدامه كما هو بدون رمز الوصول', '⚠️', 'warning', 'video');
    return streamUrl;
  }
}

function updateStreamSource(streamUrl) {
  if (isViewOnlyMode) {
    showStreamPlaceholder();
    showNotification('لا يمكن عرض الفيديو في وضع المشاهدة', '🎦', 'warning', 'video');
  } else {
    const videoStream = document.getElementById('videoStream');
    lastFailedStreamSrc = null;
    videoStream.src = buildTokenStreamUrl(streamUrl);
  }
}

function startVideoStream() {
  updateStreamSource(document.getElementById('streamUrlInput').value);
}

function showStreamPlaceholder() {
  document.getElementById('videoStream').src = VIEW_ONLY_STREAM_PLACEHOLDER;
}

function handleVideoStreamError() {
  const src = document.getElementById('videoStream').src;
  if (!src || src.startsWith('data:')) {
    return;
  }
  if (src === lastFailedStreamSrc) {
    return;
  }
  lastFailedStreamSrc = src;
  console.warn('Video stream failed to load');
  showNotification('تعذر تشغيل البث، تحقق من رابط البث وكلمة مرور الجهاز ومن أن الطائرة متصلة', '🎦', 'error', 'video');
}

function initVideoStreamErrorHandling() {
  document.getElementById('videoStream').addEventListener('error', handleVideoStreamError);
}

function updateConnectionStatus(status) {
  const statusIndicator = document.getElementById('connectionStatus');
  const statusText = document.getElementById('statusText');
  
  statusIndicator.classList.remove('status-connecting', 'status-connected', 'status-disconnected');
  
  switch(status) {
    case 'connecting':
      statusIndicator.classList.add('status-connecting');
      statusText.textContent = 'جاري الاتصال...';
      break;
    case 'connected':
      statusIndicator.classList.add('status-connected');
      statusText.textContent = 'متصل';
      break;
    case 'disconnected':
      statusIndicator.classList.add('status-disconnected');
      statusText.textContent = 'غير متصل';
      break;
  }
}

