
function generateInstanceID() {
  return 'drone-control-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function checkForDuplicateInstances() {
  if (!instanceID) {
    instanceID = generateInstanceID();
  }

  const activeInstance = localStorage.getItem('drone-control-active-instance');
  const activeInstanceTimestamp = localStorage.getItem('drone-control-heartbeat');
  const currentTime = Date.now();

  if (activeInstance && 
      activeInstance !== instanceID && 
      activeInstanceTimestamp && 
      (currentTime - activeInstanceTimestamp) < HEARTBEAT_TIMEOUT) {
    
    if (!isViewOnlyMode) {
      showDuplicateWarning();
    }
    return false;
  } else {
    localStorage.setItem('drone-control-active-instance', instanceID);
    localStorage.setItem('drone-control-heartbeat', currentTime);
    
    startHeartbeat();
    return true;
  }
}

function startHeartbeat() {
  if (instanceHeartbeatInterval) {
    clearInterval(instanceHeartbeatInterval);
  }
  
  instanceHeartbeatInterval = setInterval(() => {
    if (localStorage.getItem('drone-control-active-instance') === instanceID) {
      localStorage.setItem('drone-control-heartbeat', Date.now());
      if (!isControlEnabled && !isViewOnlyMode) {
        activateInterface();
      }
    } else {
      if (!isViewOnlyMode) {
        showDuplicateWarning();
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function takeControl() {
  localStorage.setItem('drone-control-active-instance', instanceID);
  localStorage.setItem('drone-control-heartbeat', Date.now());
  
  isViewOnlyMode = false;
  
  hideDuplicateWarning();
  activateInterface();
  
  startHeartbeat();
  
  showNotification('تم أخذ التحكم بنجاح', '✅', 'success', 'control');
  
  initializeWebSocket();
  startVideoStream();
}

function enterViewOnlyMode() {
  isViewOnlyMode = true;
  isControlEnabled = false;
  
  hideDuplicateWarning();
  
  deactivateInterface();
  
  showNotification('تم تفعيل وضع المشاهدة', '👁️', 'normal', 'control');
  
  if (instanceHeartbeatInterval) {
    clearInterval(instanceHeartbeatInterval);
    instanceHeartbeatInterval = null;
  }
}

function activateInterface() {
  const mobileInterface = document.getElementById('mobileInterface');
  if (mobileInterface) {
    mobileInterface.classList.remove('disabled-interface');
  }
  isControlEnabled = true;
}

function deactivateInterface() {
  const mobileInterface = document.getElementById('mobileInterface');
  if (mobileInterface) {
    mobileInterface.classList.add('disabled-interface');
  }
  
  closeWebSocketQuietly();
  
  if (controlsEnabled) {
    disableControls();
  }
  
  savedControlState = 0;
  wasControlEnabled = false;
  
  showStreamPlaceholder();
  
  updateConnectionStatus('disconnected');
}

function showDuplicateWarning() {
  isViewOnlyMode = true;
  isControlEnabled = false;
  
  const duplicateModal = document.getElementById('duplicateModal');
  if (duplicateModal) {
    duplicateModal.style.display = 'flex';
  }
  deactivateInterface();
}

function hideDuplicateWarning() {
  const duplicateModal = document.getElementById('duplicateModal');
  if (duplicateModal) {
    duplicateModal.style.display = 'none';
  }
}

window.addEventListener('storage', function(event) {
  if (event.key === 'drone-control-active-instance' &&
      event.newValue && event.newValue !== instanceID &&
      !isViewOnlyMode) {
    showDuplicateWarning();
  }
});

window.addEventListener('beforeunload', function() {
  if (localStorage.getItem('drone-control-active-instance') === instanceID) {
    localStorage.removeItem('drone-control-active-instance');
  }
  
  saveSettingsToLocalStorage();
  
  if (instanceHeartbeatInterval) {
    clearInterval(instanceHeartbeatInterval);
  }
});