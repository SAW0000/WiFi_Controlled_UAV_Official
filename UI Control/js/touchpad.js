
let throttleYawTouchId = null;
let pitchRollTouchId = null;

const VALUE_PRECISION = 10;

const MAX_THROTTLE = 2000;

const SIGNAL_THROTTLE_MS = 50;
let lastSignalTime = 0;

function initTouchpadControl() {
  touchpadControlActive = false;
  
  const joystickHandle = document.getElementById('joystickHandle');
  const joystickBase = document.querySelector('.joystick-container .joystick-base');
  const joystickStatus = document.getElementById('joystickStatus');
  
  joystickStatus.textContent = 'Click to activate';
  
  joystickBase.addEventListener('mousedown', activateTouchpad);
  joystickBase.addEventListener('touchstart', activateTouchpad, { passive: false });
  
  updateJoystickPosition(0, 1);
}

function initPitchRollJoystick() {
  pitchRollJoystickActive = false;
  
  const joystickPitchRollHandle = document.getElementById('joystickPitchRollHandle');
  const joystickPitchRollBase = document.getElementById('joystickPitchRollBase');
  const joystickPitchRollStatus = document.getElementById('joystickPitchRollStatus');
  
  if (!joystickPitchRollBase || !joystickPitchRollHandle) return;
  
  if (joystickPitchRollStatus) {
    joystickPitchRollStatus.textContent = 'Click to activate';
  }
  
  joystickPitchRollBase.addEventListener('mousedown', activatePitchRollJoystick);
  joystickPitchRollBase.addEventListener('touchstart', activatePitchRollJoystick, { passive: false });
  
  updatePitchRollJoystickPosition(0, 0);
  
  startSmoothingInterval();
}

function startSmoothingInterval() {
  if (smoothingIntervalId) {
    clearInterval(smoothingIntervalId);
  }
  
  smoothingIntervalId = setInterval(() => {
    if (!controlsEnabled) return;
    updateChannelOutputs(Date.now());
    sendPendingChannels();
  }, SMOOTHING_INTERVAL_MS);
}

function updateChannelOutputs(now) {
  for (let channel = 0; channel < 4; channel++) {
    const target = targetValues[channel];
    
    if (channel === 2 && isThrottleDescending) {
      const elapsed = (now - throttleDescentStartTime) / 1000;
      const descended = throttleDescentStartValue - throttleDescentRate * elapsed;
      if (!(descended > target)) {
        isThrottleDescending = false;
        smoothValues[channel] = target;
      } else {
        smoothValues[channel] = Math.max(roundToPrecision(descended), target);
      }
    } else if (smoothingEnabled) {
      smoothValues[channel] = stepTowardTarget(smoothValues[channel], target);
    } else {
      smoothValues[channel] = target;
    }
  }
}

function stepTowardTarget(current, target) {
  const diff = target - current;
  if (diff === 0 || !Number.isFinite(current)) return target;
  
  const factor = Number.isFinite(smoothingFactor) ? smoothingFactor : 1;
  let next = roundToPrecision(Math.round(current + diff * factor));
  if (next === current) {
    next = current + Math.sign(diff) * VALUE_PRECISION;
  }
  
  const remaining = target - next;
  if (Math.abs(remaining) < VALUE_PRECISION || Math.sign(remaining) !== Math.sign(diff)) {
    return target;
  }
  return next;
}

function sendPendingChannels() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  
  const pending = [];
  for (let channel = 0; channel < 4; channel++) {
    const value = smoothValues[channel];
    if (Number.isFinite(value) && value !== lastSentValues[channel]) pending.push(channel);
  }
  if (pending.length === 0 || !canSendSignal()) return;
  
  pending.forEach(channel => sendChannelValue(channel, smoothValues[channel]));
  console.log(`Sending channel values - Roll: ${smoothValues[0]}, Pitch: ${smoothValues[1]}, Throttle: ${smoothValues[2]}, Yaw: ${smoothValues[3]}`);
}

function sendChannelValue(channel, value) {
  socket.send(`1:${channel}:${value}`);
  lastSentValues[channel] = value;
  currentValues[channel] = value;
}

function applyStickTargets() {
  if (smoothingEnabled || !controlsEnabled) return;
  updateChannelOutputs(Date.now());
  sendPendingChannels();
}

function setAllChannels(values) {
  const canSend = !!socket && socket.readyState === WebSocket.OPEN;
  
  isThrottleDescending = false;
  throttleDescentStartTime = null;
  throttleDescentStartValue = null;
  
  for (let channel = 0; channel < 4; channel++) {
    const value = Number(values[channel]);
    if (!Number.isFinite(value)) continue;
    
    targetValues[channel] = value;
    smoothValues[channel] = value;
    if (canSend) {
      sendChannelValue(channel, value);
    } else {
      lastSentValues[channel] = null;
    }
  }
  return canSend;
}

function roundToPrecision(value) {
  return Math.round(value / VALUE_PRECISION) * VALUE_PRECISION;
}

function stickAxisValue(axis, atMinus, center, atPlus) {
  if (axis <= -1) return atMinus;
  if (axis >= 1) return atPlus;
  if (axis === 0) return center;
  
  const end = axis < 0 ? atMinus : atPlus;
  const value = roundToPrecision(Math.round(center + Math.abs(axis) * (end - center)));
  return Math.min(Math.max(value, Math.min(center, end)), Math.max(center, end));
}

function canSendSignal() {
  const now = Date.now();
  if (now - lastSignalTime >= SIGNAL_THROTTLE_MS) {
    lastSignalTime = now;
    return true;
  }
  return false;
}

function activateTouchpad(event) {
  event.preventDefault();
  
  if (!controlsEnabled) {
    showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'touchpad');
    return;
  }
  
  if (isViewOnlyMode) {
    showNotification('لا يمكن استخدام وضع التحكم في وضع المشاهدة', '⚠️', 'warning', 'touchpad');
    return;
  }
  
  touchpadControlActive = true;
  
  isThrottleDescending = false;
  
  const joystickHandle = document.getElementById('joystickHandle');
  const joystickStatus = document.getElementById('joystickStatus');
  
  joystickHandle.classList.add('active');
  joystickStatus.classList.add('active');
  joystickStatus.textContent = 'Active';
  
  if (event.type === 'touchstart') {
    throttleYawTouchId = event.changedTouches[0].identifier;
  }
  
  handleTouchpadMove(event);
  
  if (event.type === 'mousedown') {
    document.addEventListener('mousemove', handleTouchpadMove);
    document.addEventListener('mouseup', deactivateTouchpad);
    document.addEventListener('mouseleave', deactivateTouchpad);
  } else if (event.type === 'touchstart') {
    document.addEventListener('touchmove', handleTouchpadMove, { passive: false });
    document.addEventListener('touchend', deactivateTouchpad);
    document.addEventListener('touchcancel', deactivateTouchpad);
  }
}

function deactivateTouchpad(event) {
  if (!touchpadControlActive) return;
  
  if (event && (event.type === 'touchend' || event.type === 'touchcancel')) {
    let touchFound = false;
    for (let i = 0; i < event.changedTouches.length; i++) {
      if (event.changedTouches[i].identifier === throttleYawTouchId) {
        touchFound = true;
        break;
      }
    }
    
    if (!touchFound) return;
    
    throttleYawTouchId = null;
  }
  
  touchpadControlActive = false;
  
  document.removeEventListener('mousemove', handleTouchpadMove);
  document.removeEventListener('touchmove', handleTouchpadMove);
  document.removeEventListener('mouseup', deactivateTouchpad);
  document.removeEventListener('touchend', deactivateTouchpad);
  document.removeEventListener('mouseleave', deactivateTouchpad);
  document.removeEventListener('touchcancel', deactivateTouchpad);
  
  const joystickHandle = document.getElementById('joystickHandle');
  const joystickStatus = document.getElementById('joystickStatus');
  
  joystickHandle.classList.remove('active');
  joystickStatus.classList.remove('active');
  joystickStatus.textContent = 'Click to activate';
  
  if (smoothValues[2] > MIN_THROTTLE) {
    throttleDescentStartTime = Date.now();
    throttleDescentStartValue = smoothValues[2];
    isThrottleDescending = true;
  }
  targetValues[2] = MIN_THROTTLE;
  
  targetValues[3] = advancedButtonSettings.yaw.center;
  applyStickTargets();
  
  updateJoystickPosition(0, 1);
}

function handleTouchpadMove(event) {
  if (!touchpadControlActive || !controlsEnabled) return;
  
  event.preventDefault();
  
  let clientX, clientY;
  
  if (event.type === 'touchmove') {
    let touchFound = false;
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      if (touch.identifier === throttleYawTouchId) {
        clientX = touch.clientX;
        clientY = touch.clientY;
        touchFound = true;
        break;
      }
    }
    
    if (!touchFound) return;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  
  const joystickBase = document.querySelector('.joystick-container .joystick-base');
  const baseRect = joystickBase.getBoundingClientRect();
  const baseCenterX = baseRect.left + baseRect.width / 2;
  const baseCenterY = baseRect.top + baseRect.height / 2;
  
  const deltaX = (clientX - baseCenterX) / touchpadMaxDistance;
  const deltaY = (clientY - baseCenterY) / touchpadMaxDistance;
  
  const clampedX = Math.max(-1, Math.min(1, deltaX));
  const clampedY = Math.max(-1, Math.min(1, deltaY));
  
  const throttleValue = stickAxisValue(-clampedY, MIN_THROTTLE, Math.round((MIN_THROTTLE + MAX_THROTTLE) / 2), MAX_THROTTLE);
  
  const yawValue = stickAxisValue(
    clampedX,
    advancedButtonSettings.yaw.left,
    advancedButtonSettings.yaw.center,
    advancedButtonSettings.yaw.right
  );
  
  isThrottleDescending = false;
  
  const joystickStatus = document.getElementById('joystickStatus');
  joystickStatus.textContent = `T: ${throttleValue} Y: ${yawValue}`;
  
  updateJoystickPosition(clampedX, clampedY);
  
  targetValues[2] = throttleValue;
  targetValues[3] = yawValue;
  applyStickTargets();
}

function activatePitchRollJoystick(event) {
  event.preventDefault();
  
  if (!controlsEnabled) {
    showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'joystick');
    return;
  }
  
  if (isViewOnlyMode) {
    showNotification('لا يمكن استخدام وضع التحكم في وضع المشاهدة', '⚠️', 'warning', 'joystick');
    return;
  }
  
  pitchRollJoystickActive = true;
  
  const joystickPitchRollHandle = document.getElementById('joystickPitchRollHandle');
  const joystickPitchRollStatus = document.getElementById('joystickPitchRollStatus');
  
  if (joystickPitchRollHandle) {
    joystickPitchRollHandle.classList.add('active');
  }
  
  if (joystickPitchRollStatus) {
    joystickPitchRollStatus.classList.add('active');
    joystickPitchRollStatus.textContent = 'Active';
  }
  
  if (event.type === 'touchstart') {
    pitchRollTouchId = event.changedTouches[0].identifier;
  }
  
  handlePitchRollJoystickMove(event);
  
  if (event.type === 'mousedown') {
    document.addEventListener('mousemove', handlePitchRollJoystickMove);
    document.addEventListener('mouseup', deactivatePitchRollJoystick);
    document.addEventListener('mouseleave', deactivatePitchRollJoystick);
  } else if (event.type === 'touchstart') {
    document.addEventListener('touchmove', handlePitchRollJoystickMove, { passive: false });
    document.addEventListener('touchend', deactivatePitchRollJoystick);
    document.addEventListener('touchcancel', deactivatePitchRollJoystick);
  }
}

function deactivatePitchRollJoystick(event) {
  if (!pitchRollJoystickActive) return;
  
  if (event && (event.type === 'touchend' || event.type === 'touchcancel')) {
    let touchFound = false;
    for (let i = 0; i < event.changedTouches.length; i++) {
      if (event.changedTouches[i].identifier === pitchRollTouchId) {
        touchFound = true;
        break;
      }
    }
    
    if (!touchFound) return;
    
    pitchRollTouchId = null;
  }
  
  pitchRollJoystickActive = false;
  
  document.removeEventListener('mousemove', handlePitchRollJoystickMove);
  document.removeEventListener('touchmove', handlePitchRollJoystickMove);
  document.removeEventListener('mouseup', deactivatePitchRollJoystick);
  document.removeEventListener('touchend', deactivatePitchRollJoystick);
  document.removeEventListener('mouseleave', deactivatePitchRollJoystick);
  document.removeEventListener('touchcancel', deactivatePitchRollJoystick);
  
  const joystickPitchRollHandle = document.getElementById('joystickPitchRollHandle');
  const joystickPitchRollStatus = document.getElementById('joystickPitchRollStatus');
  
  if (joystickPitchRollHandle) {
    joystickPitchRollHandle.classList.remove('active');
  }
  
  if (joystickPitchRollStatus) {
    joystickPitchRollStatus.classList.remove('active');
    joystickPitchRollStatus.textContent = 'Click to activate';
  }
  
  targetValues[0] = advancedButtonSettings.roll.center;
  targetValues[1] = advancedButtonSettings.pitch.center;
  applyStickTargets();
  
  updatePitchRollJoystickPosition(0, 0);
}

function handlePitchRollJoystickMove(event) {
  if (!pitchRollJoystickActive || !controlsEnabled) return;
  
  event.preventDefault();
  
  let clientX, clientY;
  
  if (event.type === 'touchmove') {
    let touchFound = false;
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      if (touch.identifier === pitchRollTouchId) {
        clientX = touch.clientX;
        clientY = touch.clientY;
        touchFound = true;
        break;
      }
    }
    
    if (!touchFound) return;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  
  const joystickPitchRollBase = document.getElementById('joystickPitchRollBase');
  const baseRect = joystickPitchRollBase.getBoundingClientRect();
  const baseCenterX = baseRect.left + baseRect.width / 2;
  const baseCenterY = baseRect.top + baseRect.height / 2;
  
  const deltaX = (clientX - baseCenterX) / pitchRollMaxDistance;
  const deltaY = (clientY - baseCenterY) / pitchRollMaxDistance;
  
  const clampedX = Math.max(-1, Math.min(1, deltaX));
  const clampedY = Math.max(-1, Math.min(1, deltaY));
  
  const rollValue = stickAxisValue(
    clampedX,
    advancedButtonSettings.roll.left,
    advancedButtonSettings.roll.center,
    advancedButtonSettings.roll.right
  );
  
  const pitchValue = stickAxisValue(
    clampedY,
    advancedButtonSettings.pitch.up,
    advancedButtonSettings.pitch.center,
    advancedButtonSettings.pitch.down
  );
  
  const joystickPitchRollStatus = document.getElementById('joystickPitchRollStatus');
  if (joystickPitchRollStatus) {
    joystickPitchRollStatus.textContent = `R: ${rollValue} P: ${pitchValue}`;
  }
  
  updatePitchRollJoystickPosition(clampedX, clampedY);
  
  targetValues[0] = rollValue;
  targetValues[1] = pitchValue;
  applyStickTargets();
}

function updateJoystickPosition(normalizedX, normalizedY) {
  const joystickHandle = document.getElementById('joystickHandle');
  
  const joystickBase = document.querySelector('.joystick-container .joystick-base');
  const baseWidth = joystickBase.offsetWidth;
  const baseHeight = joystickBase.offsetHeight;
  
  const maxOffset = Math.min(baseWidth, baseHeight) * 0.4;
  const xOffset = normalizedX * maxOffset;
  const yOffset = normalizedY * maxOffset;
  
  joystickHandle.style.transform = `translate(calc(-50% + ${xOffset}px), calc(-50% + ${yOffset}px))`;
}

function updatePitchRollJoystickPosition(normalizedX, normalizedY) {
  const joystickPitchRollHandle = document.getElementById('joystickPitchRollHandle');
  
  if (!joystickPitchRollHandle) return;
  
  const joystickPitchRollBase = document.getElementById('joystickPitchRollBase');
  
  if (!joystickPitchRollBase) return;
  
  const baseWidth = joystickPitchRollBase.offsetWidth;
  const baseHeight = joystickPitchRollBase.offsetHeight;
  
  const maxOffset = Math.min(baseWidth, baseHeight) * 0.4;
  const xOffset = normalizedX * maxOffset;
  const yOffset = normalizedY * maxOffset;
  
  joystickPitchRollHandle.style.transform = `translate(calc(-50% + ${xOffset}px), calc(-50% + ${yOffset}px))`;
}