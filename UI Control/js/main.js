
document.addEventListener('DOMContentLoaded', function() {
  updateAllSliderVisuals();
  
  connectAllSlidersWithInputs();
  
  initializeTestingPanel();
  
  initTouchpadControl();
  
  initPitchRollJoystick();
  
  loadSettingsFromLocalStorage();
  
  const isFirstInstance = checkForDuplicateInstances();
  
  document.getElementById('viewOnlyBtn').addEventListener('click', enterViewOnlyMode);
  document.getElementById('takeControlBtn').addEventListener('click', takeControl);
  
  document.querySelectorAll('.slider-progress').forEach(container => {
    const slider = container.querySelector('input[type="range"]');
    const percent = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    
    slider.style.background = `linear-gradient(to right, 
                              var(--primary-color) 0%, 
                              var(--primary-color) ${percent}%, 
                              var(--card-bg) ${percent}%, 
                              var(--card-bg) 100%)`;
  });
  
  updateSliderProgress();
  
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('open');
  });
  
  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.remove('open');
    saveSettingsToLocalStorage();
  });
  
  document.getElementById('testingBtn').addEventListener('click', () => {
    document.getElementById('testingPanel').classList.add('open');
  });
  
  document.getElementById('closeTestingBtn').addEventListener('click', () => {
    document.getElementById('testingPanel').classList.remove('open');
  });
  
  document.getElementById('detectionBtn').addEventListener('click', () => {
    document.getElementById('detectionPanel').classList.add('open');
    document.getElementById('detectionList').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('loadingIndicator').style.display = 'none';
  });
  
  document.getElementById('closeDetectionBtn').addEventListener('click', () => {
    document.getElementById('detectionPanel').classList.remove('open');
  });
  
  const controlModeSelector = document.getElementById('controlModeSelector');
  controlModeSelector.value = controlMode;
  controlModeSelector.addEventListener('change', function() {
    controlMode = this.value;
    updateControlModeUI();
    saveSettingsToLocalStorage();
    showNotification(
      controlMode === 'dpad' ? 'تم تفعيل وضع D-Pad للتحكم بالاتجاهات' : 'تم تفعيل وضع Joystick للتحكم بالاتجاهات',
      controlMode === 'dpad' ? '⊞' : '⊕',
      'normal',
      'controls'
    );
  });
  
  updateControlModeUI();
  
  const smoothingToggle = document.getElementById('smoothingToggle');
  const smoothingToggleWrapper = document.querySelector('#smoothingToggle').closest('.theme-toggle-wrapper');
  
  if (smoothingToggleWrapper) {
    smoothingToggleWrapper.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      smoothingToggle.checked = !smoothingToggle.checked;
      
      handleSmoothingSettingsChange();
    });
  }
  
  if (smoothingToggle) {
    smoothingToggle.addEventListener('change', function(e) {
      e.stopPropagation();
      handleSmoothingSettingsChange();
    });
  }
  
  connectSliderWithInput('smoothingFactorSlider', 'smoothingFactorValueInput', (value) => {
    smoothingFactor = parseFloat(value) / 100;
    saveSettingsToLocalStorage();
    startSmoothingInterval();
  });
  
  connectSliderWithInput('throttleDescentRateSlider', 'throttleDescentRateValueInput', (value) => {
    throttleDescentRate = parseInt(value);
    saveSettingsToLocalStorage();
  });
  
  updateSmoothingSettingsVisibility();
  
  const themeToggle = document.getElementById('themeToggle');
  const themeToggleWrapper = document.querySelector('#themeToggle').closest('.theme-toggle-wrapper');
  
  themeToggleWrapper.addEventListener('click', function(e) {
    if (e.currentTarget === themeToggleWrapper) {
      themeToggle.checked = !themeToggle.checked;
      toggleTheme();
      e.preventDefault();
    }
  });
  
  themeToggle.addEventListener('change', function(e) {
    if (!e.defaultPrevented) {
      toggleTheme();
    }
  });
  
  const savedTheme = localStorage.getItem('drone_theme');
  if (savedTheme) {
    if (savedTheme === 'light' && !document.body.classList.contains('light-theme')) {
      document.body.classList.add('light-theme');
      updateNavbarTheme(false);
      if (themeToggle) themeToggle.checked = true;
    } else if (savedTheme === 'dark' && document.body.classList.contains('light-theme')) {
      document.body.classList.remove('light-theme');
      updateNavbarTheme(true);
      if (themeToggle) themeToggle.checked = false;
    }
  }
  
  const controlBtn = document.getElementById('controlBtn');
  const landingGearBtn = document.getElementById('landingGearBtn');
  const ledBtn = document.getElementById('ledBtn');
  
  controlBtn.addEventListener('click', toggleControls);
  
  landingGearBtn.addEventListener('click', function() {
    if (!this.classList.contains('disabled')) {
      toggleLandingGear();
    } else {
      showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'controls');
    }
  });
  
  ledBtn.addEventListener('click', function() {
    if (!this.classList.contains('disabled')) {
      toggleLED();
    } else {
      showNotification('يجب تفعيل مود التحكم اولا', '⚠️', 'warning', 'controls');
    }
  });
  
  document.getElementById('applySettingsBtn').addEventListener('click', applySettings);
  
  document.getElementById('refreshDetectionsBtn').addEventListener('click', fetchDetectedPersons);
  document.getElementById('clearDetectionsBtn').addEventListener('click', clearAllDetections);
  
  document.querySelectorAll('.d-pad-button').forEach(button => {
    button.addEventListener('mousedown', function() {
      startButtonAction(this.id);
    });
    
    button.addEventListener('touchstart', function(e) {
      e.preventDefault();
      startButtonAction(this.id);
    });
    
    button.addEventListener('mouseup', function() {
      stopButtonAction(this.id);
    });
    
    button.addEventListener('touchend', function() {
      stopButtonAction(this.id);
    });
    
    button.addEventListener('mouseleave', function() {
      stopButtonAction(this.id);
    });
  });
  
  const joystickHandle = document.getElementById('joystickHandle');
  const joystickBase = document.querySelector('.joystick-container .joystick-base');

  updateJoystickPosition(0, 1);
  
  const buttonSelector = document.getElementById('buttonSelector');
  buttonSelector.addEventListener('change', handleButtonSettingsChange);
  
  document.addEventListener('keydown', handleKeyboardControl);
  document.addEventListener('keyup', handleKeyboardControl);
  
  const videoStream = document.getElementById('videoStream');
  const mobileInterface = document.querySelector('.mobile-interface');

  mobileInterface.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
  });

  videoStream.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
  });

  let touchTimer;
  mobileInterface.addEventListener('touchstart', function(e) {
    if (touchTimer) clearTimeout(touchTimer);
    
    touchTimer = setTimeout(function() {
    }, 500);
  }, { passive: false });

  mobileInterface.addEventListener('touchend', function(e) {
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: true });

  mobileInterface.addEventListener('touchmove', function(e) {
    if (touchTimer) clearTimeout(touchTimer);
    
  }, { passive: true });

  document.querySelectorAll('.control-button, .d-pad-button, .nav-button').forEach(button => {
    button.style.pointerEvents = 'auto';
  });

  document.querySelectorAll('#controlBtn, #landingGearBtn, #ledBtn').forEach(button => {
    button.style.pointerEvents = 'auto';
    button.style.touchAction = 'manipulation';
  });
  
  document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
  document.getElementById('importSettingsBtn').addEventListener('click', importSettings);
  document.getElementById('importSettingsInput').addEventListener('change', handleImportedFile);
  
  const savedControlEnabled = localStorage.getItem('drone_controls_enabled');
  if (savedControlEnabled === 'true' && wsConnected) {
    setTimeout(() => {
      toggleControls();
    }, 1000);
  }
  
  const savedLandingGearDown = localStorage.getItem('drone_landing_gear_down');
  if (savedLandingGearDown === 'true') {
    isLandingGearDown = true;
    updateLandingGearButtonState();
    animateLandingGearDown();
  }
  
  const savedLEDOn = localStorage.getItem('drone_led_on');
  if (savedLEDOn === 'true') {
    isLEDOn = true;
    updateLEDButtonState();
  }
  
  initVideoStreamErrorHandling();
  
  if (isFirstInstance) {
    initializeWebSocket();
    activateInterface();
    
    startVideoStream();
    
    setTimeout(() => {
      showNotification('مرحباً بك في واجهة التحكم بالطائرة، اضغط على زر 🎮 لبدء التحكم', '🚁', 'normal', 'welcome');
      
      setTimeout(() => {
        showNotification('استخدم SPACE للتحكم و CTRL للهبوط و ALT للإضاءة', '⌨️', 'normal', 'shortcuts');
      }, 2000);
    }, 1000);
  } else {
  }
  
  setTimeout(() => {
    updateAllSliderVisuals();
  }, 100);
});

window.onload = function() {
  updateSliderProgress();
  updateAllSliderVisuals();
};

function updateControlModeUI() {
  const dpadContainer = document.getElementById('dpadContainer');
  const joystickPitchRollContainer = document.getElementById('joystickPitchRollContainer');
  const controlModeSelector = document.getElementById('controlModeSelector');
  
  if (controlMode === 'dpad') {
    dpadContainer.style.display = 'block';
    joystickPitchRollContainer.style.display = 'none';
    if (controlModeSelector) controlModeSelector.value = 'dpad';
  } else {
    dpadContainer.style.display = 'none';
    joystickPitchRollContainer.style.display = 'block';
    if (controlModeSelector) controlModeSelector.value = 'joystick';
  }
}

function connectAllSlidersWithInputs() {
  
  connectSliderWithInput('failsafeRollSlider', 'failsafeRollValueInput', (value) => {
    failsafeValues[0] = parseInt(value);
    saveSettingsToLocalStorage();
    
    scheduleFailsafeValueSend(0);
  });
  
  connectSliderWithInput('failsafePitchSlider', 'failsafePitchValueInput', (value) => {
    failsafeValues[1] = parseInt(value);
    saveSettingsToLocalStorage();
    
    scheduleFailsafeValueSend(1);
  });
  
  connectSliderWithInput('failsafeThrottleSlider', 'failsafeThrottleValueInput', (value) => {
    failsafeValues[2] = parseInt(value);
    saveSettingsToLocalStorage();
    
    scheduleFailsafeValueSend(2);
  });
  
  connectSliderWithInput('failsafeYawSlider', 'failsafeYawValueInput', (value) => {
    failsafeValues[3] = parseInt(value);
    saveSettingsToLocalStorage();
    
    scheduleFailsafeValueSend(3);
  });
  
  connectSliderWithInput('armingSlider', 'armingValueInput', (value) => {
    armingValue = parseInt(value);
    saveSettingsToLocalStorage();
  });
  
  connectSliderWithInput('disarmingSlider', 'disarmingValueInput', (value) => {
    disarmingValue = parseInt(value);
    saveSettingsToLocalStorage();
  });
  
  connectSliderWithInput('smoothingFactorSlider', 'smoothingFactorValueInput', (value) => {
    smoothingFactor = parseInt(value) / 100;
    saveSettingsToLocalStorage();
  });
}