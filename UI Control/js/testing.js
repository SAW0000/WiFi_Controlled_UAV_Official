
const testChannels = [1, 2, 3, 4, 5, 6, 7, 8];

function sendTestChannel(channel, value) {
  if (channel >= 0 && channel < 4) {
    setAllChannels({ [channel]: value });
  } else {
    socket.send(`1:${channel}:${value}`);
  }
}

function sendTestSignal(channelIndex) {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'testing');
    return;
  }
  
  if (!wsConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    showNotification('WebSocket غير متصل', '⚠️', 'error', 'testing');
    return;
  }
  
  const channelNum = parseInt(document.getElementById(`channel${testChannels[channelIndex]}NumberInput`).value);
  const channelValue = parseInt(document.getElementById(`channel${testChannels[channelIndex]}ValueInput`).value);
  
  if (isNaN(channelNum) || channelNum < 0 || channelNum > 7) {
    showNotification('رقم القناة يجب أن يكون بين 0 و 7', '⚠️', 'error', 'testing');
    return;
  }
  
  if (isNaN(channelValue) || channelValue < 885 || channelValue > 2000) {
    showNotification('قيمة القناة يجب أن تكون بين 885 و 2000', '⚠️', 'error', 'testing');
    return;
  }
  
  sendTestChannel(channelNum, channelValue);
  console.log(`Sent test signal: 1:${channelNum}:${channelValue}`);
  
  showNotification(`تم إرسال القيمة ${channelValue} إلى القناة ${channelNum}`, '📡', 'success', 'testing');
}

function resetChannels() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'testing');
    return;
  }
  
  if (!wsConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    showNotification('WebSocket غير متصل', '⚠️', 'error', 'testing');
    return;
  }
  
  const defaultValues = {
    0: 1500,
    1: 1500,
    2: 885,
    3: 1500
  };
  
  const armingChannel = readInputInRange('armingChannelInput');
  if (!isNaN(armingChannel)) {
    setAllChannels(defaultValues);
    
    sendTestChannel(armingChannel, 950);
    
    for (let i = 0; i < 4; i++) {
      const channelNum = i;
      document.getElementById(`channel${i+1}NumberInput`).value = channelNum;
      document.getElementById(`channel${i+1}ValueInput`).value = defaultValues[i];
      document.getElementById(`channel${i+1}Slider`).value = defaultValues[i];
      updateSliderVisual(`channel${i+1}Slider`);
    }
    
    showNotification('تم إعادة تعيين القنوات إلى القيم الافتراضية', '🔄', 'success', 'testing');
  } else {
    showNotification('خطأ في قناة التسليح', '⚠️', 'error', 'testing');
  }
}

function sendArmingTest() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'testing');
    return;
  }
  
  if (!wsConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    showNotification('WebSocket غير متصل', '⚠️', 'error', 'testing');
    return;
  }
  
  const armingValues = {
    0: 1500,
    1: 1500,
    2: 885,
    3: 2000
  };
  
  const armingChannel = readInputInRange('armingChannelInput');
  const armingValue = readInputInRange('armingValueInput');

  if (!isNaN(armingChannel) && !isNaN(armingValue)) {
    setAllChannels(armingValues);
    
    sendTestChannel(armingChannel, armingValue);
    
    for (let i = 0; i < 4; i++) {
      const channelNum = i;
      document.getElementById(`channel${i+1}NumberInput`).value = channelNum;
      document.getElementById(`channel${i+1}ValueInput`).value = armingValues[i];
      document.getElementById(`channel${i+1}Slider`).value = armingValues[i];
      updateSliderVisual(`channel${i+1}Slider`);
    }
    
    showNotification('تم إرسال إشارات التسليح', '🚁', 'success', 'testing');
  } else {
    showNotification('خطأ في قناة التسليح أو قيمتها', '⚠️', 'error', 'testing');
  }
}

function sendDisarmingTest() {
  if (isViewOnlyMode) {
    showNotification('لا يمكن التحكم في وضع المشاهدة', '⚠️', 'warning', 'testing');
    return;
  }
  
  if (!wsConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    showNotification('WebSocket غير متصل', '⚠️', 'error', 'testing');
    return;
  }
  
  const disarmingValues = {
    0: 1500,
    1: 1500,
    2: 885,
    3: 1500
  };
  
  const disarmingChannel = readInputInRange('disarmingChannelInput');

  if (!isNaN(disarmingChannel)) {
    setAllChannels(disarmingValues);
    
    sendTestChannel(disarmingChannel, 950);
    
    for (let i = 0; i < 4; i++) {
      const channelNum = i;
      document.getElementById(`channel${i+1}NumberInput`).value = channelNum;
      document.getElementById(`channel${i+1}ValueInput`).value = disarmingValues[i];
      document.getElementById(`channel${i+1}Slider`).value = disarmingValues[i];
      updateSliderVisual(`channel${i+1}Slider`);
    }
    
    showNotification('تم إرسال إشارات إلغاء التسليح', '🛑', 'success', 'testing');
  } else {
    showNotification('خطأ في قناة إلغاء التسليح', '⚠️', 'error', 'testing');
  }
}

function connectTestChannelSlider(channelNum) {
  const sliderId = `channel${channelNum}Slider`;
  const valueInputId = `channel${channelNum}ValueInput`;
  const channelInputId = `channel${channelNum}NumberInput`;
  
  const slider = document.getElementById(sliderId);
  const valueInput = document.getElementById(valueInputId);
  const channelInput = document.getElementById(channelInputId);
  
  if (!slider || !valueInput || !channelInput) return;
  
  slider.addEventListener('input', function() {
    valueInput.value = this.value;
    updateSliderVisual(sliderId);
    
    const channelIndex = testChannels.indexOf(channelNum);
    if (channelIndex !== -1) {
      sendTestSignal(channelIndex);
    }
  });
  
  valueInput.addEventListener('input', function() {
    let value = parseInt(this.value);
    const min = parseInt(slider.min);
    const max = parseInt(slider.max);
    
    if (isNaN(value)) value = min;
    if (value < min) value = min;
    if (value > max) value = max;
    
    slider.value = value;
    updateSliderVisual(sliderId);
  });
  
  valueInput.addEventListener('blur', function() {
    let value = parseInt(this.value);
    const min = parseInt(slider.min);
    const max = parseInt(slider.max);
    
    if (isNaN(value) || value < min) {
      value = min;
    } else if (value > max) {
      value = max;
    }
    
    this.value = value;
    slider.value = value;
    updateSliderVisual(sliderId);
    
    const channelIndex = testChannels.indexOf(channelNum);
    if (channelIndex !== -1) {
      sendTestSignal(channelIndex);
    }
  });
  
  valueInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      this.blur();
      e.preventDefault();
    }
  });
  
  channelInput.addEventListener('blur', function() {
    let channelNumber = parseInt(this.value);
    
    if (isNaN(channelNumber) || channelNumber < 0) {
      channelNumber = 0;
    } else if (channelNumber > 7) {
      channelNumber = 7;
    }
    
    this.value = channelNumber;
    
    const channelIndex = testChannels.indexOf(channelNum);
    if (channelIndex !== -1) {
      sendTestSignal(channelIndex);
    }
  });
  
  channelInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      this.blur();
      e.preventDefault();
    }
  });
}

function connectAllTestChannelSliders() {
  for (const channelNum of testChannels) {
    connectTestChannelSlider(channelNum);
  }
}

function connectArmingDisarmingSliders() {
  const armingSlider = document.getElementById('armingSlider');
  const armingValueInput = document.getElementById('armingValueInput');
  const armingChannelInput = document.getElementById('armingChannelInput');
  
  if (armingSlider && armingValueInput && armingChannelInput) {
    armingSlider.addEventListener('input', function() {
      armingValueInput.value = this.value;
      updateSliderVisual('armingSlider');
      armingValue = parseInt(this.value);
      saveArmingSettings();
    });
    
    armingValueInput.addEventListener('input', function() {
      let value = parseInt(this.value);
      const min = parseInt(armingSlider.min);
      const max = parseInt(armingSlider.max);
      
      if (isNaN(value)) value = min;
      if (value < min) value = min;
      if (value > max) value = max;
      
      armingSlider.value = value;
      updateSliderVisual('armingSlider');
      armingValue = value;
    });
    
    armingValueInput.addEventListener('blur', function() {
      let value = parseInt(this.value);
      const min = parseInt(armingSlider.min);
      const max = parseInt(armingSlider.max);
      
      if (isNaN(value) || value < min) {
        value = min;
      } else if (value > max) {
        value = max;
      }
      
      this.value = value;
      armingSlider.value = value;
      updateSliderVisual('armingSlider');
      armingValue = value;
      saveArmingSettings();
    });
    
    armingChannelInput.addEventListener('input', function() {
      armingChannel = clampToInputRange(this.value, 'armingChannelInput', armingChannel);
    });
    
    armingChannelInput.addEventListener('blur', function() {
      let channelNum = parseInt(this.value);
      
      if (isNaN(channelNum) || channelNum < 0) {
        channelNum = 0;
      } else if (channelNum > 7) {
        channelNum = 7;
      }
      
      this.value = channelNum;
      armingChannel = channelNum;
      saveArmingSettings();
    });
  }
  
  const disarmingSlider = document.getElementById('disarmingSlider');
  const disarmingValueInput = document.getElementById('disarmingValueInput');
  const disarmingChannelInput = document.getElementById('disarmingChannelInput');
  
  if (disarmingSlider && disarmingValueInput && disarmingChannelInput) {
    disarmingSlider.addEventListener('input', function() {
      disarmingValueInput.value = this.value;
      updateSliderVisual('disarmingSlider');
      disarmingValue = parseInt(this.value);
      saveArmingSettings();
    });
    
    disarmingValueInput.addEventListener('input', function() {
      let value = parseInt(this.value);
      const min = parseInt(disarmingSlider.min);
      const max = parseInt(disarmingSlider.max);
      
      if (isNaN(value)) value = min;
      if (value < min) value = min;
      if (value > max) value = max;
      
      disarmingSlider.value = value;
      updateSliderVisual('disarmingSlider');
      disarmingValue = value;
    });
    
    disarmingValueInput.addEventListener('blur', function() {
      let value = parseInt(this.value);
      const min = parseInt(disarmingSlider.min);
      const max = parseInt(disarmingSlider.max);
      
      if (isNaN(value) || value < min) {
        value = min;
      } else if (value > max) {
        value = max;
      }
      
      this.value = value;
      disarmingSlider.value = value;
      updateSliderVisual('disarmingSlider');
      disarmingValue = value;
      saveArmingSettings();
    });
    
    disarmingChannelInput.addEventListener('input', function() {
      disarmingChannel = clampToInputRange(this.value, 'disarmingChannelInput', disarmingChannel);
    });
    
    disarmingChannelInput.addEventListener('blur', function() {
      let channelNum = parseInt(this.value);
      
      if (isNaN(channelNum) || channelNum < 0) {
        channelNum = 0;
      } else if (channelNum > 7) {
        channelNum = 7;
      }
      
      this.value = channelNum;
      disarmingChannel = channelNum;
      saveArmingSettings();
    });
  }
}

function saveArmingSettings() {
  const settings = {
    armingChannel: armingChannel,
    armingValue: armingValue,
    disarmingChannel: disarmingChannel,
    disarmingValue: disarmingValue
  };
  
  localStorage.setItem(SETTINGS_KEYS.ARMING, JSON.stringify(settings));
}

function loadArmingSettings() {
  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEYS.ARMING));
  
  if (settings) {
    if (settings.armingChannel !== undefined) {
      armingChannel = clampToInputRange(settings.armingChannel, 'armingChannelInput', armingChannel);
      document.getElementById('armingChannelInput').value = armingChannel;
    }

    if (settings.armingValue !== undefined) {
      armingValue = clampToInputRange(settings.armingValue, 'armingSlider', armingValue);
      document.getElementById('armingSlider').value = armingValue;
      document.getElementById('armingValueInput').value = armingValue;
      updateSliderVisual('armingSlider');
    }

    if (settings.disarmingChannel !== undefined) {
      disarmingChannel = clampToInputRange(settings.disarmingChannel, 'disarmingChannelInput', disarmingChannel);
      document.getElementById('disarmingChannelInput').value = disarmingChannel;
    }

    if (settings.disarmingValue !== undefined) {
      disarmingValue = clampToInputRange(settings.disarmingValue, 'disarmingSlider', disarmingValue);
      document.getElementById('disarmingSlider').value = disarmingValue;
      document.getElementById('disarmingValueInput').value = disarmingValue;
      updateSliderVisual('disarmingSlider');
    }
  }
}

function initializeTestingPanel() {
  connectAllTestChannelSliders();
  connectArmingDisarmingSliders();
  loadArmingSettings();
  
  document.getElementById('resetChannelsBtn').addEventListener('click', resetChannels);
  document.getElementById('armingTestBtn').addEventListener('click', sendArmingTest);
  document.getElementById('disarmingTestBtn').addEventListener('click', sendDisarmingTest);
}