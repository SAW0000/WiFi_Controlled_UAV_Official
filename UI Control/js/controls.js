
const pressedKeys = new Set();

let disarmingTimer = null;

const ARM_COMMAND_DELAY_MS = 300;
let armingTimer = null;

function cancelPendingArm() {
  if (armingTimer) {
    clearTimeout(armingTimer);
    armingTimer = null;
  }
}

function cycleControlState(options = {}) {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'controls');
    return;
  }
  
  if (controlState === 3) {
    console.log('Control button ignored while disarming');
    return;
  }
  
  if (!wsConnected) {
    showNotification('لا يمكن تفعيل مود التحكم، لا يوجد اتصال', '⚠️', 'error', 'controls');
    return;
  }
  
  controlState = (controlState + 1) % 4;
  
  switch(controlState) {
    case 0:
      disableControls();
      break;
    
    case 1:
      enableArmedMode(options.resume === true);
      break;
    
    case 2:
      enableFailsafeMode();
      break;
    
    case 3:
      if (!enableDisarmingMode()) {
        controlState = 2;
        break;
      }
      disarmingTimer = setTimeout(() => {
        disarmingTimer = null;
        controlState = 0;
        disableControls();
      }, 1000);
      break;
  }
  
  localStorage.setItem('drone_control_state', controlState.toString());
}

function enableArmedMode(resume = false) {
  controlsEnabled = true;
  
  const controlBg = document.getElementById('controlBg');
  const powerIcon = document.getElementById('powerIcon');
  const controlBtn = document.getElementById('controlBtn');
  
  controlBg.classList.remove('active', 'failsafe', 'failsafe-flashing');
  if (failsafeAnimationInterval) {
    clearInterval(failsafeAnimationInterval);
    failsafeAnimationInterval = null;
  }
  
  controlBg.classList.add('armed');
  controlBtn.classList.add('armed');
  powerIcon.setAttribute('stroke', 'white');
  
  enableControlButtons();
  
  cancelPendingArm();
  if (resume) {
    for (let channel = 0; channel < 4; channel++) {
      lastSentValues[channel] = null;
    }
    sendArmingSignal();
  } else {
    setAllChannels({
      0: advancedButtonSettings.roll.center,
      1: advancedButtonSettings.pitch.center,
      2: MIN_THROTTLE,
      3: advancedButtonSettings.yaw.center
    });

    armingTimer = setTimeout(() => {
      armingTimer = null;
      if (controlState === 1 && controlsEnabled) {
        sendArmingSignal();
      }
    }, ARM_COMMAND_DELAY_MS);
  }

  showNotification('تم تفعيل وضع التشغيل (Armed)', '✅', 'success', 'armed');
  
  localStorage.setItem('drone_controls_enabled', 'true');
}

function enableFailsafeMode() {
  controlsEnabled = true;
  cancelPendingArm();
  
  const controlBg = document.getElementById('controlBg');
  const powerIcon = document.getElementById('powerIcon');
  const controlBtn = document.getElementById('controlBtn');
  
  controlBg.classList.remove('active', 'armed');
  
  controlBg.classList.add('failsafe', 'failsafe-flashing');
  controlBtn.classList.add('failsafe');
  powerIcon.setAttribute('stroke', 'white');
  
  if (setAllChannels(failsafeValues)) {
    console.log(`Sent failsafe values to normal channels: ${failsafeValues[0]}, ${failsafeValues[1]}, ${failsafeValues[2]}, ${failsafeValues[3]}`);
  }
  
  showNotification('تم تفعيل وضع الهبوط الامن (failsafe landing)', '⚠️', 'warning', 'failsafe');
}

function enableDisarmingMode() {
  cancelPendingArm();

  if (!sendDisarmingSignal()) {
    return false;
  }
  
  const controlBg = document.getElementById('controlBg');
  const powerIcon = document.getElementById('powerIcon');
  const controlBtn = document.getElementById('controlBtn');
  
  controlBg.classList.remove('active', 'armed', 'failsafe', 'failsafe-flashing');
  controlBtn.classList.remove('armed', 'failsafe', 'active');
  powerIcon.setAttribute('stroke', '#e94560');
  
  if (failsafeAnimationInterval) {
    clearInterval(failsafeAnimationInterval);
    failsafeAnimationInterval = null;
  }
  
  showNotification('تم إيقاف تشغيل الطائرة (Disarmed)', '🛑', 'normal', 'disarmed');
  return true;
}

function toggleControls() {
  cycleControlState();
}

function sendArmingSignal() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    const channel = readInputInRange('armingChannelInput');
    const value = readInputInRange('armingValueInput');

    if (!isNaN(channel) && !isNaN(value)) {
      const message = `1:${channel}:${value}`;
      socket.send(message);
      console.log(`Sent arming signal: ${message}`);
    } else {
      console.warn('Arming signal not sent: channel or value out of range');
      showNotification('إعدادات التسليح غير صالحة، لم يتم إرسال إشارة التسليح', '⚠️', 'error', 'controls');
    }
  }
}

function sendDisarmingSignal() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn('Disarming signal not sent: no open connection');
    showNotification('WebSocket غير متصل', '⚠️', 'error', 'controls');
    return false;
  }

  const channel = readInputInRange('disarmingChannelInput');
  const value = readInputInRange('disarmingValueInput');
  
  if (!isNaN(channel) && !isNaN(value)) {
    const message = `1:${channel}:${value}`;
    socket.send(message);
    console.log(`Sent disarming signal: ${message}`);
    return true;
  }
  console.warn('Disarming signal not sent: channel or value out of range');
  showNotification('إعدادات فصل التسليح غير صالحة، لم يتم إرسال إشارة فصل التسليح', '⚠️', 'error', 'controls');
  return false;
}

function enableControlButtons() {
  const landingGearBtn = document.getElementById('landingGearBtn');
  landingGearBtn.classList.remove('disabled');
  
  const ledBtn = document.getElementById('ledBtn');
  ledBtn.classList.remove('disabled');
}

function disableControls() {
  controlsEnabled = false;
  controlState = 0;
  
  if (disarmingTimer) {
    clearTimeout(disarmingTimer);
    disarmingTimer = null;
  }
  cancelPendingArm();
  
  const controlBg = document.getElementById('controlBg');
  const powerIcon = document.getElementById('powerIcon');
  const controlBtn = document.getElementById('controlBtn');
  
  controlBg.classList.remove('active', 'armed', 'failsafe', 'failsafe-flashing');
  controlBtn.classList.remove('active', 'armed', 'failsafe');
  powerIcon.setAttribute('stroke', '#e94560');
  
  if (failsafeAnimationInterval) {
    clearInterval(failsafeAnimationInterval);
    failsafeAnimationInterval = null;
  }
  
  disableControlButtons();
  
  activeButtons.forEach(buttonId => {
    stopButtonAction(buttonId);
  });
  activeButtons.clear();
  
  pressedKeys.clear();
  
  if (pitchRollJoystickActive) {
    deactivatePitchRollJoystick();
  }
  
  showNotification('تم ايقاف مود التحكم', '🛑', 'normal', 'controls');
  
  localStorage.setItem('drone_controls_enabled', 'false');
  localStorage.setItem('drone_control_state', '0');
}

function disableControlButtons() {
  const landingGearBtn = document.getElementById('landingGearBtn');
  landingGearBtn.classList.add('disabled');
  
  if (isLandingGearDown) {
    isLandingGearDown = false;
    updateLandingGearButtonState();
    
    localStorage.setItem('drone_landing_gear_down', 'false');
  }
  
  const ledBtn = document.getElementById('ledBtn');
  ledBtn.classList.add('disabled');
  
  if (isLEDOn) {
    isLEDOn = false;
    updateLEDButtonState();
    
    localStorage.setItem('drone_led_on', 'false');
  }
}

function toggleLandingGear() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'controls');
    return;
  }
  
  if (!controlsEnabled) {
    showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'controls');
    return;
  }
  
  if (landingGearAnimating) return;
  
  landingGearAnimating = true;
  isLandingGearDown = !isLandingGearDown;
  
  updateLandingGearButtonState();
  
  if (isLandingGearDown) {
    animateLandingGearDown();
  } else {
    animateLandingGearUp();
  }
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    const stateValue = isLandingGearDown ? 0 : 1;
    const message = `2:${stateValue}:0`;
    socket.send(message);
  }
  
  showNotification(
    isLandingGearDown ? 'تم تفعيل معدات الهبوط' : 'تم رفع معدات الهبوط',
    isLandingGearDown ? '⏬' : '⏫',
    'normal',
    'landing'
  );
  
  localStorage.setItem('drone_landing_gear_down', isLandingGearDown ? 'true' : 'false');
  
  setTimeout(() => {
    landingGearAnimating = false;
  }, 600);
}

function updateLandingGearButtonState() {
  const landingGearBg = document.getElementById('landingGearBg');
  const landingGearIcon = document.getElementById('landingGearIcon');
  const landingGearBtn = document.getElementById('landingGearBtn');
  
  if (isLandingGearDown) {
    landingGearBg.classList.add('active');
    landingGearIcon.setAttribute('stroke', 'white');
  } else {
    landingGearBg.classList.remove('active');
    landingGearIcon.setAttribute('stroke', '#e94560');
  }
}

function animateLandingGearDown() {
  const leftLeg = document.getElementById('left-leg');
  const rightLeg = document.getElementById('right-leg');
  
  leftLeg.setAttribute('x2', '-20');
  rightLeg.setAttribute('x2', '20');
  
  setTimeout(() => {
    leftLeg.setAttribute('y2', '25');
    rightLeg.setAttribute('y2', '25');
    
    setTimeout(() => {
      leftLeg.setAttribute('x2', '-25');
      rightLeg.setAttribute('x2', '25');
    }, 200);
  }, 150);
}

function animateLandingGearUp() {
  const leftLeg = document.getElementById('left-leg');
  const rightLeg = document.getElementById('right-leg');
  
  leftLeg.setAttribute('x2', '-20');
  rightLeg.setAttribute('x2', '20');
  
  setTimeout(() => {
    leftLeg.setAttribute('y2', '10');
    rightLeg.setAttribute('y2', '10');
    
    setTimeout(() => {
      leftLeg.setAttribute('x2', '-25');
      rightLeg.setAttribute('x2', '25');
    }, 200);
  }, 150);
}

function toggleLED() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'controls');
    return;
  }
  
  if (!controlsEnabled) {
    showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'controls');
    return;
  }
  
  isLEDOn = !isLEDOn;
  updateLEDButtonState();
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    const message = `3:${isLEDOn ? 1 : 0}:0`;
    socket.send(message);
  }
  
  localStorage.setItem('drone_led_on', isLEDOn ? 'true' : 'false');
  
  showNotification(
    isLEDOn ? 'تم تشغيل الإضاءة' : 'تم إيقاف الإضاءة',
    '💡',
    isLEDOn ? 'success' : 'normal',
    'led'
  );
}

function updateLEDButtonState() {
  const ledBg = document.getElementById('ledBg');
  const ledIcon = document.getElementById('ledIcon');
  
  if (isLEDOn) {
    ledBg.classList.add('active');
    ledIcon.setAttribute('stroke', 'white');
  } else {
    ledBg.classList.remove('active');
    ledIcon.setAttribute('stroke', '#e94560');
  }
}

function startButtonAction(buttonId) {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'controls');
    return;
  }
  
  if (!controlsEnabled) {
    showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'controls');
    return;
  }
  
  activeButtons.add(buttonId);
  
  const button = document.getElementById(buttonId);
  if (button) button.classList.add('active');
  
  updateControlValues();
}

function updateControlValues() {
  if (!controlsEnabled) {
    return;
  }
  
  const upActive = activeButtons.has('up1');
  const downActive = activeButtons.has('down1');
  const leftActive = activeButtons.has('left1');
  const rightActive = activeButtons.has('right1');
  
  let rollValue;
  if (leftActive && rightActive) {
    rollValue = advancedButtonSettings.roll.center;
  } else if (leftActive) {
    rollValue = advancedButtonSettings.roll.left;
  } else if (rightActive) {
    rollValue = advancedButtonSettings.roll.right;
  } else {
    rollValue = advancedButtonSettings.roll.center;
  }
  
  let pitchValue;
  if (upActive && downActive) {
    pitchValue = advancedButtonSettings.pitch.center;
  } else if (upActive) {
    pitchValue = advancedButtonSettings.pitch.up;
  } else if (downActive) {
    pitchValue = advancedButtonSettings.pitch.down;
  } else {
    pitchValue = advancedButtonSettings.pitch.center;
  }
  
  targetValues[0] = smoothValues[0] = rollValue;
  targetValues[1] = smoothValues[1] = pitchValue;
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendChannelValue(0, rollValue);
    sendChannelValue(1, pitchValue);
  }
  
  console.log(`Setting Pitch: ${pitchValue}, Roll: ${rollValue}`);
}

function stopButtonAction(buttonId) {
  activeButtons.delete(buttonId);
  
  const button = document.getElementById(buttonId);
  if (button) button.classList.remove('active');
  
  if (buttonIntervals[buttonId]) {
    clearInterval(buttonIntervals[buttonId]);
    delete buttonIntervals[buttonId];
  }
  
  updateControlValues();
}

function handleKeyboardControl(event) {
  if (isViewOnlyMode) return;
  
  if (document.activeElement.tagName === 'INPUT' || 
      document.activeElement.tagName === 'TEXTAREA' || 
      document.activeElement.tagName === 'SELECT') {
    return;
  }
  
  if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
    if (event.type === 'keydown' && !event.repeat) {
      toggleLandingGear();
    }
    return;
  }
  
  if (event.code === 'AltLeft' || event.code === 'AltRight') {
    if (event.type === 'keydown' && !event.repeat) {
      toggleLED();
    }
    event.preventDefault();
    return;
  }
  
  if (event.code === 'Space') {
    if (event.type === 'keydown' && !event.repeat) {
      cycleControlState();
    }
    event.preventDefault();
    return;
  }
  
  if (controlMode === 'dpad') {
    const dpadButtonId = keyToDPadMap[event.code];
    
    if (dpadButtonId) {
      event.preventDefault();
      
      if (event.type === 'keydown') {
        pressedKeys.add(event.code);
        
        const dpadButton = document.getElementById(dpadButtonId);
        if (dpadButton && !activeButtons.has(dpadButtonId)) {
          startButtonAction(dpadButtonId);
        }
      } else if (event.type === 'keyup') {
        pressedKeys.delete(event.code);
        
        stopButtonAction(dpadButtonId);
      }
    }
  }
}