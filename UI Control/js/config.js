
let controlsEnabled = false;

let controlState = 0;

let previousControlState = 0;
let wasControlsEnabled = false;

let controlMode = 'dpad';

let isLandingGearDown = false;
let isLEDOn = false;
let landingGearAnimating = false;

let wsConnected = false;

let currentValues = {
  0: 1500,
  1: 1500,
  2: 885,
  3: 1500
};

let targetValues = {
  0: 1500,
  1: 1500,
  2: 885,
  3: 1500
};

let smoothValues = {
  0: 1500,
  1: 1500,
  2: 885,
  3: 1500
};

let lastSentValues = {
  0: null,
  1: null,
  2: null,
  3: null
};

let smoothingEnabled = true;
let smoothingFactor = 0.3;
let smoothingIntervalId = null;
const SMOOTHING_INTERVAL_MS = 20;

let throttleDescentRate = 800;
let throttleDescentStartTime = null;
let throttleDescentStartValue = null;
let isThrottleDescending = false;

let failsafeValues = {
  0: 1500,
  1: 1500,
  2: 885,
  3: 1500
};

let armingStickValues = {
  0: 1500,
  1: 1500,
  2: 885,
  3: 2000
};

let armingChannel = 4;
let armingValue = 2000;
let disarmingChannel = 4;
let disarmingValue = 950;

let advancedButtonSettings = {
  'pitch': {
    'up': 1700,
    'center': 1500,
    'down': 1300
  },
  'roll': {
    'left': 1300,
    'center': 1500,
    'right': 1700
  },
  'yaw': {
    'left': 1300,
    'center': 1500,
    'right': 1700
  }
};

let buttonSettings = {
  'up1': [1500, 1700, 885, 1500],
  'down1': [1500, 1300, 885, 1500],
  'left1': [1300, 1500, 885, 1500],
  'right1': [1700, 1500, 885, 1500],
};

let activeButtons = new Set();
let buttonIntervals = {};

const keyToDPadMap = {
  'KeyW': 'up1',
  'KeyA': 'left1',
  'KeyS': 'down1',
  'KeyD': 'right1',
};

let touchpadControlActive = false;
let touchpadStartX = 0;
let touchpadStartY = 0;
let touchpadMaxDistance = 50;

let pitchRollJoystickActive = false;
let pitchRollStartX = 0;
let pitchRollStartY = 0;
let pitchRollMaxDistance = 50;

const MIN_ROLL_PITCH_YAW = 950;
const MIN_THROTTLE = 885;

let isControlEnabled = false;
let isViewOnlyMode = false;
let instanceID = null;
let instanceHeartbeatInterval = null;
const HEARTBEAT_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 5000;

let failsafeAnimationInterval = null;

const SETTINGS_KEYS = {
  FAILSAFE: 'drone_failsafe_settings',
  BUTTON: 'drone_button_settings',
  CONNECTION: 'drone_connection_settings',
  THEME: 'drone_theme_settings',
  ARMING: 'drone_arming_settings',
  ARMING_STICKS: 'drone_arming_sticks_settings',
  ADVANCED_BUTTON: 'drone_advanced_button_settings',
  SMOOTHING: 'drone_smoothing_settings',
  THROTTLE_DESCENT: 'drone_throttle_descent_settings'
};