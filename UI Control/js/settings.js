
const LEGACY_DETECTION_URL = 'http://localhost:8000';
const DETECTION_URL_MIGRATED_KEY = 'drone_detection_url_default_cleared';

function saveSettingsToLocalStorage() {
  const failsafeSettings = {
    roll: parseInt(document.getElementById('failsafeRollSlider').value),
    pitch: parseInt(document.getElementById('failsafePitchSlider').value),
    throttle: parseInt(document.getElementById('failsafeThrottleSlider').value),
    yaw: parseInt(document.getElementById('failsafeYawSlider').value)
  };
  localStorage.setItem(SETTINGS_KEYS.FAILSAFE, JSON.stringify(failsafeSettings));
  
  const armingSettings = {
    armingChannel: clampToInputRange(document.getElementById('armingChannelInput').value, 'armingChannelInput', armingChannel),
    armingValue: clampToInputRange(document.getElementById('armingSlider').value, 'armingSlider', armingValue),
    disarmingChannel: clampToInputRange(document.getElementById('disarmingChannelInput').value, 'disarmingChannelInput', disarmingChannel),
    disarmingValue: clampToInputRange(document.getElementById('disarmingSlider').value, 'disarmingSlider', disarmingValue)
  };
  localStorage.setItem(SETTINGS_KEYS.ARMING, JSON.stringify(armingSettings));
  
  localStorage.setItem(SETTINGS_KEYS.ADVANCED_BUTTON, JSON.stringify(advancedButtonSettings));
  
  localStorage.setItem(SETTINGS_KEYS.BUTTON, JSON.stringify(buttonSettings));
  
  const connectionSettings = {
    streamUrl: document.getElementById('streamUrlInput').value,
    ipAddress: document.getElementById('ipAddressInput').value,
    wsPort: document.getElementById('wsPortInput').value,
    wsToken: document.getElementById('wsTokenInput').value,
    detectionUrl: document.getElementById('detectionUrlInput').value
  };
  localStorage.setItem(SETTINGS_KEYS.CONNECTION, JSON.stringify(connectionSettings));
  
  const themeSettings = {
    isDarkMode: !document.body.classList.contains('light-theme')
  };
  localStorage.setItem(SETTINGS_KEYS.THEME, JSON.stringify(themeSettings));
  
  const smoothingSettings = {
    enabled: smoothingEnabled,
    factor: smoothingFactor,
    throttleDescentRate: throttleDescentRate
  };
  localStorage.setItem(SETTINGS_KEYS.SMOOTHING, JSON.stringify(smoothingSettings));
  
  localStorage.setItem('drone_current_values', JSON.stringify(currentValues));
  
  localStorage.setItem('drone_failsafe_values', JSON.stringify(failsafeValues));
  
  localStorage.setItem('drone_control_mode', controlMode);
}

function loadSettingsFromLocalStorage() {
  const storedFailsafeValues = JSON.parse(localStorage.getItem('drone_failsafe_values'));
  if (storedFailsafeValues) {
    for (let channel = 0; channel < FAILSAFE_SLIDER_IDS.length; channel++) {
      applyFailsafeValue(channel, storedFailsafeValues[channel]);
    }
  }
  const failsafeSettings = JSON.parse(localStorage.getItem(SETTINGS_KEYS.FAILSAFE));
  if (failsafeSettings) {
    applyFailsafeValue(0, failsafeSettings.roll);
    applyFailsafeValue(1, failsafeSettings.pitch);
    applyFailsafeValue(2, failsafeSettings.throttle);
    applyFailsafeValue(3, failsafeSettings.yaw);
  }
  
  const armingSettings = JSON.parse(localStorage.getItem(SETTINGS_KEYS.ARMING));
  if (armingSettings) {
    if (armingSettings.armingChannel !== undefined) {
      armingChannel = clampToInputRange(armingSettings.armingChannel, 'armingChannelInput', armingChannel);
      document.getElementById('armingChannelInput').value = armingChannel;
    }
    if (armingSettings.armingValue !== undefined) {
      armingValue = clampToInputRange(armingSettings.armingValue, 'armingSlider', armingValue);
      document.getElementById('armingSlider').value = armingValue;
      document.getElementById('armingValueInput').value = armingValue;
    }
    if (armingSettings.disarmingChannel !== undefined) {
      disarmingChannel = clampToInputRange(armingSettings.disarmingChannel, 'disarmingChannelInput', disarmingChannel);
      document.getElementById('disarmingChannelInput').value = disarmingChannel;
    }
    if (armingSettings.disarmingValue !== undefined) {
      disarmingValue = clampToInputRange(armingSettings.disarmingValue, 'disarmingSlider', disarmingValue);
      document.getElementById('disarmingSlider').value = disarmingValue;
      document.getElementById('disarmingValueInput').value = disarmingValue;
    }
  }
  
  const advancedButtonSettingsFromStorage = JSON.parse(localStorage.getItem(SETTINGS_KEYS.ADVANCED_BUTTON));
  if (advancedButtonSettingsFromStorage) {
    advancedButtonSettings = advancedButtonSettingsFromStorage;
    
    updateLegacyButtonSettings();
  }
  
  const buttonSettingsFromStorage = JSON.parse(localStorage.getItem(SETTINGS_KEYS.BUTTON));
  if (buttonSettingsFromStorage && !advancedButtonSettingsFromStorage) {
    buttonSettings = buttonSettingsFromStorage;
    
    updateAdvancedButtonSettingsFromLegacy();
  }
  
  const connectionSettings = JSON.parse(localStorage.getItem(SETTINGS_KEYS.CONNECTION));
  const dropLegacyDetectionUrl = localStorage.getItem(DETECTION_URL_MIGRATED_KEY) === null;
  if (dropLegacyDetectionUrl) {
    localStorage.setItem(DETECTION_URL_MIGRATED_KEY, '1');
  }
  if (connectionSettings) {
    if (connectionSettings.streamUrl) {
      document.getElementById('streamUrlInput').value = connectionSettings.streamUrl;
    }
    if (connectionSettings.ipAddress) {
      document.getElementById('ipAddressInput').value = connectionSettings.ipAddress;
    }
    if (connectionSettings.wsPort) {
      document.getElementById('wsPortInput').value = connectionSettings.wsPort;
    }
    if (connectionSettings.wsToken) {
      document.getElementById('wsTokenInput').value = connectionSettings.wsToken;
    }
    const detectionUrl = connectionSettings.detectionUrl;
    const isLegacyDetectionUrl = typeof detectionUrl === 'string' &&
      detectionUrl.trim().replace(/\/+$/, '') === LEGACY_DETECTION_URL;
    if (detectionUrl && !(dropLegacyDetectionUrl && isLegacyDetectionUrl)) {
      document.getElementById('detectionUrlInput').value = detectionUrl;
    }
  }
  
  const themeSettings = JSON.parse(localStorage.getItem(SETTINGS_KEYS.THEME));
  if (themeSettings) {
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.checked = !themeSettings.isDarkMode;
    
    if (themeSettings.isDarkMode && document.body.classList.contains('light-theme')) {
      toggleTheme();
    } else if (!themeSettings.isDarkMode && !document.body.classList.contains('light-theme')) {
      toggleTheme();
    }
  }
  
  const smoothingSettings = JSON.parse(localStorage.getItem(SETTINGS_KEYS.SMOOTHING));
  if (smoothingSettings) {
    if (smoothingSettings.enabled !== undefined) {
      smoothingEnabled = smoothingSettings.enabled;
      document.getElementById('smoothingToggle').checked = smoothingEnabled;
    }
    if (smoothingSettings.factor !== undefined) {
      smoothingFactor = smoothingSettings.factor;
      document.getElementById('smoothingFactorSlider').value = smoothingFactor * 100;
      document.getElementById('smoothingFactorValueInput').value = Math.round(smoothingFactor * 100);
      updateSliderVisual('smoothingFactorSlider');
    }
    if (smoothingSettings.throttleDescentRate !== undefined) {
      throttleDescentRate = smoothingSettings.throttleDescentRate;
      document.getElementById('throttleDescentRateSlider').value = throttleDescentRate;
      document.getElementById('throttleDescentRateValueInput').value = throttleDescentRate;
      updateSliderVisual('throttleDescentRateSlider');
    }
  }
  
  const storedCurrentValues = JSON.parse(localStorage.getItem('drone_current_values'));
  if (storedCurrentValues) {
    currentValues = storedCurrentValues;
  }
  
  
  const savedControlMode = localStorage.getItem('drone_control_mode');
  if (savedControlMode) {
    controlMode = savedControlMode;
  }
  
  setTimeout(() => {
    updateAllSliderVisuals();
  }, 0);
  
  updateSmoothingSettingsVisibility();
}

function applyFailsafeValue(channel, rawValue) {
  if (rawValue === undefined || rawValue === null) return;
  
  const sliderId = FAILSAFE_SLIDER_IDS[channel];
  const value = clampToInputRange(rawValue, sliderId, NaN);
  if (isNaN(value)) return;
  
  document.getElementById(sliderId).value = value;
  document.getElementById(sliderId.replace('Slider', 'ValueInput')).value = value;
  failsafeValues[channel] = value;
  updateSliderVisual(sliderId);
}

function updateLegacyButtonSettings() {
  buttonSettings['up1'] = [
    advancedButtonSettings.roll.center,
    advancedButtonSettings.pitch.up,
    885,
    advancedButtonSettings.yaw.center
  ];

  buttonSettings['down1'] = [
    advancedButtonSettings.roll.center,
    advancedButtonSettings.pitch.down,
    885,
    advancedButtonSettings.yaw.center
  ];

  buttonSettings['left1'] = [
    advancedButtonSettings.roll.left,
    advancedButtonSettings.pitch.center,
    885,
    advancedButtonSettings.yaw.center
  ];

  buttonSettings['right1'] = [
    advancedButtonSettings.roll.right,
    advancedButtonSettings.pitch.center,
    885,
    advancedButtonSettings.yaw.center
  ];
}

function updateAdvancedButtonSettingsFromLegacy() {
  advancedButtonSettings.pitch.up = buttonSettings['up1'][1];
  advancedButtonSettings.pitch.down = buttonSettings['down1'][1];
  advancedButtonSettings.roll.left = buttonSettings['left1'][0];
  advancedButtonSettings.roll.right = buttonSettings['right1'][0];
  
  advancedButtonSettings.pitch.center = 1500;
  advancedButtonSettings.roll.center = 1500;
  advancedButtonSettings.yaw.center = 1500;
}

function applySettings() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن تغيير الإعدادات في وضع المشاهدة', '⚠️', 'warning', 'settings');
    return;
  }
  
  const streamUrl = document.getElementById('streamUrlInput').value;
  const ipAddress = document.getElementById('ipAddressInput').value;
  const wsPort = document.getElementById('wsPortInput').value;
  const detectionUrl = document.getElementById('detectionUrlInput').value;
  
  updateStreamSource(streamUrl);
  
  smoothingEnabled = document.getElementById('smoothingToggle').checked;
  smoothingFactor = parseFloat(document.getElementById('smoothingFactorSlider').value) / 100;
  
  updateSmoothingSettingsVisibility();
  
  saveSettingsToLocalStorage();
  
  if (socket) {
    socket.close();
  }
  
  setTimeout(() => {
    initializeWebSocket();
  }, 500);
  
  startSmoothingInterval();
  
  document.getElementById('settingsPanel').classList.remove('open');
  
  showNotification('تم ضبط الاعدادات بنجاح', '✅', 'success', 'settings');
}

function handleButtonSettingsChange() {
  const selector = document.getElementById('buttonSelector');
  const selectedControl = selector.value;
  const buttonSettingsPanel = document.getElementById('buttonSettingsPanel');
  
  if (selectedControl === 'default') {
    buttonSettingsPanel.style.display = 'none';
    return;
  }
  
  buttonSettingsPanel.style.display = 'block';
  
  buttonSettingsPanel.innerHTML = '';
  
  let slidersHtml = '';
  
  if (selectedControl === 'pitch') {
    slidersHtml = `
      <div class="settings-section-title">Pitch Control Values</div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Pitch Up Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="pitchUpValueInput" value="${advancedButtonSettings.pitch.up}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.pitch.up}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.pitch.up}" class="slider" id="pitchUpSlider">
        </div>
      </div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Pitch Center Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="pitchCenterValueInput" value="${advancedButtonSettings.pitch.center}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.pitch.center}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.pitch.center}" class="slider" id="pitchCenterSlider">
        </div>
      </div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Pitch Down Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="pitchDownValueInput" value="${advancedButtonSettings.pitch.down}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.pitch.down}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.pitch.down}" class="slider" id="pitchDownSlider">
        </div>
      </div>
    `;
  } else if (selectedControl === 'roll') {
    slidersHtml = `
      <div class="settings-section-title">Roll Control Values</div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Roll Left Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="rollLeftValueInput" value="${advancedButtonSettings.roll.left}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.roll.left}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.roll.left}" class="slider" id="rollLeftSlider">
        </div>
      </div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Roll Center Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="rollCenterValueInput" value="${advancedButtonSettings.roll.center}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.roll.center}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.roll.center}" class="slider" id="rollCenterSlider">
        </div>
      </div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Roll Right Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="rollRightValueInput" value="${advancedButtonSettings.roll.right}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.roll.right}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.roll.right}" class="slider" id="rollRightSlider">
        </div>
      </div>
    `;
  } else if (selectedControl === 'yaw') {
    slidersHtml = `
      <div class="settings-section-title">Yaw Control Values</div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Yaw Left Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="yawLeftValueInput" value="${advancedButtonSettings.yaw.left}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.yaw.left}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.yaw.left}" class="slider" id="yawLeftSlider">
        </div>
      </div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Yaw Center Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="yawCenterValueInput" value="${advancedButtonSettings.yaw.center}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.yaw.center}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.yaw.center}" class="slider" id="yawCenterSlider">
        </div>
      </div>
      
      <div class="slider-wrapper">
        <div class="slider-label">
          <span class="slider-name">Yaw Right Value</span>
          <div class="slider-value-container">
            <input type="number" class="slider-value-input" id="yawRightValueInput" value="${advancedButtonSettings.yaw.right}" min="950" max="2000">
          </div>
        </div>
        <div class="slider-progress" data-value="${advancedButtonSettings.yaw.right}" data-min="950" data-max="2000">
          <input type="range" min="950" max="2000" value="${advancedButtonSettings.yaw.right}" class="slider" id="yawRightSlider">
        </div>
      </div>
    `;
  }
  
  buttonSettingsPanel.innerHTML = slidersHtml;
  
  if (selectedControl === 'pitch') {
    connectSliderWithInput('pitchUpSlider', 'pitchUpValueInput', (value) => {
      advancedButtonSettings.pitch.up = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
    
    connectSliderWithInput('pitchCenterSlider', 'pitchCenterValueInput', (value) => {
      advancedButtonSettings.pitch.center = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
    
    connectSliderWithInput('pitchDownSlider', 'pitchDownValueInput', (value) => {
      advancedButtonSettings.pitch.down = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
  } else if (selectedControl === 'roll') {
    connectSliderWithInput('rollLeftSlider', 'rollLeftValueInput', (value) => {
      advancedButtonSettings.roll.left = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
    
    connectSliderWithInput('rollCenterSlider', 'rollCenterValueInput', (value) => {
      advancedButtonSettings.roll.center = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
    
    connectSliderWithInput('rollRightSlider', 'rollRightValueInput', (value) => {
      advancedButtonSettings.roll.right = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
  } else if (selectedControl === 'yaw') {
    connectSliderWithInput('yawLeftSlider', 'yawLeftValueInput', (value) => {
      advancedButtonSettings.yaw.left = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
    
    connectSliderWithInput('yawCenterSlider', 'yawCenterValueInput', (value) => {
      advancedButtonSettings.yaw.center = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
    
    connectSliderWithInput('yawRightSlider', 'yawRightValueInput', (value) => {
      advancedButtonSettings.yaw.right = parseInt(value);
      updateLegacyButtonSettings();
      saveSettingsToLocalStorage();
    });
  }
  
  updateAllSliderVisuals();
}

function handleSmoothingSettingsChange() {
  const smoothingToggle = document.getElementById('smoothingToggle');
  const smoothingFactorContainer = document.getElementById('smoothingFactorContainer');
  
  smoothingEnabled = smoothingToggle.checked;
  
  if (smoothingEnabled) {
    smoothingFactorContainer.style.display = 'block';
  } else {
    smoothingFactorContainer.style.display = 'none';
  }
  
  saveSettingsToLocalStorage();
  
  startSmoothingInterval();
}

function updateSmoothingSettingsVisibility() {
  const smoothingToggle = document.getElementById('smoothingToggle');
  const smoothingFactorContainer = document.getElementById('smoothingFactorContainer');
  
  if (!smoothingToggle || !smoothingFactorContainer) return;
  
  if (smoothingEnabled) {
    smoothingFactorContainer.style.display = 'block';
    smoothingToggle.checked = true;
  } else {
    smoothingFactorContainer.style.display = 'none';
    smoothingToggle.checked = false;
  }
}

function exportSettings() {
  const settings = {
    failsafe: {
      roll: parseInt(document.getElementById('failsafeRollSlider').value),
      pitch: parseInt(document.getElementById('failsafePitchSlider').value),
      throttle: parseInt(document.getElementById('failsafeThrottleSlider').value),
      yaw: parseInt(document.getElementById('failsafeYawSlider').value)
    },
    arming: {
      armingChannel: clampToInputRange(document.getElementById('armingChannelInput').value, 'armingChannelInput', armingChannel),
      armingValue: clampToInputRange(document.getElementById('armingSlider').value, 'armingSlider', armingValue),
      disarmingChannel: clampToInputRange(document.getElementById('disarmingChannelInput').value, 'disarmingChannelInput', disarmingChannel),
      disarmingValue: clampToInputRange(document.getElementById('disarmingSlider').value, 'disarmingSlider', disarmingValue)
    },
    advancedButtonSettings: advancedButtonSettings,
    buttonSettings: buttonSettings,
    connection: {
      streamUrl: document.getElementById('streamUrlInput').value,
      ipAddress: document.getElementById('ipAddressInput').value,
      wsPort: document.getElementById('wsPortInput').value,
      detectionUrl: document.getElementById('detectionUrlInput').value
    },
    theme: {
      isDarkMode: !document.body.classList.contains('light-theme')
    },
    smoothing: {
      enabled: smoothingEnabled,
      factor: smoothingFactor
    },
    controlMode: controlMode
  };
  
  const settingsJSON = JSON.stringify(settings, null, 2);
  
  const blob = new Blob([settingsJSON], { type: 'application/json' });
  
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = 'drone_settings.json';
  
  document.body.appendChild(link);
  link.click();
  
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
  
  showNotification('تم تصدير الإعدادات بنجاح', '💾', 'success', 'settings');
}

function importSettings() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن استيراد الإعدادات في وضع المشاهدة', '⚠️', 'warning', 'settings');
    return;
  }
  
  document.getElementById('importSettingsInput').click();
}

function handleImportedFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  
  reader.onload = function(e) {
    try {
      const settings = JSON.parse(e.target.result);
      
      
      if (settings.failsafe) {
        applyFailsafeValue(0, settings.failsafe.roll);
        applyFailsafeValue(1, settings.failsafe.pitch);
        applyFailsafeValue(2, settings.failsafe.throttle);
        applyFailsafeValue(3, settings.failsafe.yaw);
      }
      
      if (settings.arming) {
        if (settings.arming.armingChannel !== undefined) {
          armingChannel = clampToInputRange(settings.arming.armingChannel, 'armingChannelInput', armingChannel);
          document.getElementById('armingChannelInput').value = armingChannel;
        }
        if (settings.arming.armingValue !== undefined) {
          armingValue = clampToInputRange(settings.arming.armingValue, 'armingSlider', armingValue);
          document.getElementById('armingSlider').value = armingValue;
          document.getElementById('armingValueInput').value = armingValue;
        }
        if (settings.arming.disarmingChannel !== undefined) {
          disarmingChannel = clampToInputRange(settings.arming.disarmingChannel, 'disarmingChannelInput', disarmingChannel);
          document.getElementById('disarmingChannelInput').value = disarmingChannel;
        }
        if (settings.arming.disarmingValue !== undefined) {
          disarmingValue = clampToInputRange(settings.arming.disarmingValue, 'disarmingSlider', disarmingValue);
          document.getElementById('disarmingSlider').value = disarmingValue;
          document.getElementById('disarmingValueInput').value = disarmingValue;
        }
      }
      
      if (settings.advancedButtonSettings) {
        advancedButtonSettings = settings.advancedButtonSettings;
        
        updateLegacyButtonSettings();
        
        const buttonSelector = document.getElementById('buttonSelector');
        if (buttonSelector.value !== 'default') {
          handleButtonSettingsChange();
        }
      }
      else if (settings.buttonSettings) {
        buttonSettings = settings.buttonSettings;
        
        updateAdvancedButtonSettingsFromLegacy();
      }
      
      if (settings.connection) {
        if (settings.connection.streamUrl) {
          document.getElementById('streamUrlInput').value = settings.connection.streamUrl;
        }
        if (settings.connection.ipAddress) {
          document.getElementById('ipAddressInput').value = settings.connection.ipAddress;
        }
        if (settings.connection.wsPort) {
          document.getElementById('wsPortInput').value = settings.connection.wsPort;
        }
        if (settings.connection.detectionUrl) {
          document.getElementById('detectionUrlInput').value = settings.connection.detectionUrl;
        }
      }
      
      if (settings.theme && settings.theme.isDarkMode !== undefined) {
        const themeToggle = document.getElementById('themeToggle');
        themeToggle.checked = !settings.theme.isDarkMode;
        
        if (settings.theme.isDarkMode && document.body.classList.contains('light-theme')) {
          toggleTheme();
        } else if (!settings.theme.isDarkMode && !document.body.classList.contains('light-theme')) {
          toggleTheme();
        }
      }
      
      if (settings.smoothing) {
        if (settings.smoothing.enabled !== undefined) {
          smoothingEnabled = settings.smoothing.enabled;
          document.getElementById('smoothingToggle').checked = smoothingEnabled;
          updateSmoothingSettingsVisibility();
        }
        if (settings.smoothing.factor !== undefined) {
          smoothingFactor = settings.smoothing.factor;
          document.getElementById('smoothingFactorSlider').value = smoothingFactor * 100;
          document.getElementById('smoothingFactorValueInput').value = Math.round(smoothingFactor * 100);
          updateSliderVisual('smoothingFactorSlider');
        }
        
        startSmoothingInterval();
      }
      
      if (settings.controlMode) {
        controlMode = settings.controlMode;
        
        updateControlModeUI();
      }
      
      updateAllSliderVisuals();
      
      saveSettingsToLocalStorage();
      
      sendFailsafeValues();
      
      showNotification('تم استيراد الإعدادات بنجاح', '📂', 'success', 'settings');
      
      document.getElementById('importSettingsInput').value = '';
      
    } catch (error) {
      console.error('Error importing settings:', error);
      showNotification('خطأ في استيراد الإعدادات', '⚠️', 'error', 'settings');
      
      document.getElementById('importSettingsInput').value = '';
    }
  };
  
  reader.onerror = function() {
    showNotification('خطأ في قراءة الملف', '⚠️', 'error', 'settings');
    
    document.getElementById('importSettingsInput').value = '';
  };
  
  reader.readAsText(file);
}


const DETECTION_REQUEST_TIMEOUT_MS = 15000;

let detectionFetchSeq = 0;
let detectionFetchController = null;

const deletingDetectionIds = new Set();

function getDetectionBaseUrl() {
  return document.getElementById('detectionUrlInput').value.trim().replace(/\/+$/, '');
}

function parseDetectionNumber(value) {
  const isUsable = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const number = isUsable ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function hasDetectionId(id) {
  return id !== null && id !== undefined && id !== '';
}

function normalizeDetection(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Unexpected detection item format');
  }
  const confidence = parseDetectionNumber(raw.confidence);
  return {
    id: raw.id,
    image: typeof raw.image === 'string' ? raw.image : '',
    time: parseDetectionNumber(raw.time),
    confidence: confidence === null ? 0 : confidence
  };
}

function normalizeDetectionsResponse(body) {
  let items = null;
  if (Array.isArray(body)) {
    items = body;
  } else if (body !== null && typeof body === 'object') {
    if (Array.isArray(body.detections)) items = body.detections;
    else if (Array.isArray(body.data)) items = body.data;
  }
  if (!items) throw new Error('Unexpected detections response format');
  return items.map(normalizeDetection);
}

async function requestDetections(baseUrl, signal) {
  const response = await fetch(`${baseUrl}/detections`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeDetectionsResponse(await response.json());
}

async function sendDetectionDelete(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DETECTION_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'DELETE', signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestDeleteDetection(baseUrl, id) {
  const response = await sendDetectionDelete(`${baseUrl}/detections/${encodeURIComponent(id)}`);
  if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
}

async function fetchDetectedPersons() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن تحديث قائمة الاشخاص المكتشفين وانت في وضع المشاهدة', '⚠️', 'warning', 'detection');
    return;
  }

  const baseUrl = getDetectionBaseUrl();
  if (!baseUrl) {
    showNotification('يرجى ضبط رابط اكتشاف الأشخاص في الإعدادات أولاً', '⚠️', 'warning', 'detection');
    return;
  }

  const seq = ++detectionFetchSeq;
  if (detectionFetchController) detectionFetchController.abort();
  const controller = new AbortController();
  detectionFetchController = controller;
  const timeoutId = setTimeout(() => controller.abort(), DETECTION_REQUEST_TIMEOUT_MS);

  const refreshBtn = document.getElementById('refreshDetectionsBtn');
  refreshBtn.disabled = true;
  document.getElementById('loadingIndicator').style.display = 'flex';
  document.getElementById('detectionList').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';

  try {
    const detections = await requestDetections(baseUrl, controller.signal);
    if (seq !== detectionFetchSeq) return;

    renderDetections(detections);
    showNotification('تم تحديث قائمة الاكتشافات', '🔄', 'success', 'detection');
  } catch (error) {
    if (seq !== detectionFetchSeq) return;

    console.error('Error fetching detections:', error);
    document.getElementById('detectionList').innerHTML = '';
    document.getElementById('detectionList').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    showNotification('تعذر الاتصال بخدمة اكتشاف الأشخاص', '⚠️', 'error', 'detection');
  } finally {
    clearTimeout(timeoutId);
    if (seq === detectionFetchSeq) {
      document.getElementById('loadingIndicator').style.display = 'none';
      refreshBtn.disabled = false;
      detectionFetchController = null;
    }
  }
}

function renderDetections(detections) {
  const listEl = document.getElementById('detectionList');
  const emptyEl = document.getElementById('emptyState');

  listEl.innerHTML = '';

  if (detections.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.style.display = 'block';

  detections.forEach(detection => {
    const item = document.createElement('li');
    item.className = 'detection-item';

    const img = document.createElement('img');
    img.className = 'detection-image';
    img.src = detection.image;
    img.alt = 'Detected person';

    const details = document.createElement('div');
    details.className = 'detection-details';

    const time = document.createElement('div');
    time.className = 'detection-time';
    const date = detection.time === null ? null : new Date(detection.time * 1000);
    time.textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '';

    const confidence = document.createElement('div');
    confidence.className = 'detection-confidence';
    const confidenceValue = document.createElement('span');
    confidenceValue.className = 'confidence-value';
    confidenceValue.textContent = `${Math.round(detection.confidence * 100)}%`;
    confidence.appendChild(confidenceValue);

    const actions = document.createElement('div');
    actions.className = 'detection-actions';
    if (hasDetectionId(detection.id)) {
      item.dataset.detectionId = String(detection.id);
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'detection-button';
      deleteBtn.textContent = 'حذف';
      deleteBtn.addEventListener('click', () => deleteDetection(detection.id, item));
      actions.appendChild(deleteBtn);
    }

    details.appendChild(time);
    details.appendChild(confidence);
    details.appendChild(actions);

    item.appendChild(img);
    item.appendChild(details);
    listEl.appendChild(item);
  });
}

function removeDetectionRows(key) {
  const listEl = document.getElementById('detectionList');
  listEl.querySelectorAll('.detection-item').forEach(row => {
    if (row.dataset.detectionId === key) row.remove();
  });

  if (detectionFetchController === null && !listEl.querySelector('.detection-item')) {
    listEl.style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
  }
}

function refreshDetectionsIfLoading() {
  if (detectionFetchController !== null) fetchDetectedPersons();
}

async function deleteDetection(id, item) {
  if (isViewOnlyMode) {
    showNotification('لا يمكنك مسح قائمة الاشخاص المكتشفين وانت في وضع المشاهدة', '⚠️', 'warning', 'detection');
    return;
  }

  const baseUrl = getDetectionBaseUrl();
  if (!baseUrl || !hasDetectionId(id)) return;

  const key = String(id);
  if (deletingDetectionIds.has(key)) return;
  deletingDetectionIds.add(key);

  const deleteBtn = item.querySelector('.detection-button');
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    await requestDeleteDetection(baseUrl, id);

    removeDetectionRows(key);
    refreshDetectionsIfLoading();
  } catch (error) {
    console.error('Error deleting detection:', error);
    showNotification('تعذر حذف هذا العنصر', '⚠️', 'error', 'detection');
    if (deleteBtn) deleteBtn.disabled = false;
  } finally {
    deletingDetectionIds.delete(key);
  }
}

function clearAllDetections() {
  if (isViewOnlyMode) {
    showNotification('لا يمكنك مسح قائمة الاشخاص المكتشفين وانت في وضع المشاهدة', '⚠️', 'warning', 'detection');
    return;
  }

  const baseUrl = getDetectionBaseUrl();
  if (!baseUrl) {
    showNotification('يرجى ضبط رابط اكتشاف الأشخاص في الإعدادات أولاً', '⚠️', 'warning', 'detection');
    return;
  }

  showConfirmDialog('هل انت متأكد من حذف قائمة الاشخاص المكتشفين؟', async () => {
    try {
      const response = await sendDetectionDelete(`${baseUrl}/detections`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      showNotification('تم حذف قائمة الاشخاص المكتشفين', '🗑️', 'success', 'detection');

      document.getElementById('detectionList').innerHTML = '';
      document.getElementById('detectionList').style.display = 'none';
      document.getElementById('emptyState').style.display = 'block';
      refreshDetectionsIfLoading();
    } catch (error) {
      console.error('Error clearing detections:', error);
      showNotification('تعذر حذف قائمة الاكتشافات', '⚠️', 'error', 'detection');
    }
  });
}