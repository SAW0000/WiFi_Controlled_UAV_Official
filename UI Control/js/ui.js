
function clampToInputRange(value, elementId, fallback) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  const input = document.getElementById(elementId);
  const min = input ? parseInt(input.min, 10) : NaN;
  const max = input ? parseInt(input.max, 10) : NaN;
  let result = n;
  if (!isNaN(min) && result < min) result = min;
  if (!isNaN(max) && result > max) result = max;
  return result;
}

function readInputInRange(elementId) {
  const input = document.getElementById(elementId);
  const n = input ? parseInt(input.value, 10) : NaN;
  return !isNaN(n) && clampToInputRange(n, elementId, NaN) === n ? n : NaN;
}

function showNotification(message, icon = "", type = "normal", category = "general") {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-container';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `notification-toast notification-${category}`;
  
  if (icon) {
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  } else {
    toast.innerHTML = `<span>${message}</span>`;
  }
  
  if (type === "success") {
    toast.style.borderLeftColor = "var(--success-color)";
  } else if (type === "error") {
    toast.style.borderLeftColor = "var(--error-color)";
  } else if (type === "warning") {
    toast.style.borderLeftColor = "var(--warning-color)";
  }
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        try {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        } catch (e) {
          console.error('Error removing notification:', e);
        }
      }, 300);
    }, 3000);
  }, 10);
}

function showConfirmDialog(message, onConfirm, onCancel = null) {
  const dialog = document.getElementById('confirmDialog');
  const messageElement = document.getElementById('confirmMessage');
  const confirmButton = document.getElementById('confirmButton');
  const cancelButton = document.getElementById('cancelButton');
  
  messageElement.textContent = message;
  
  dialog.classList.add('show');
  
  confirmButton.onclick = () => {
    dialog.classList.remove('show');
    if (onConfirm) onConfirm();
  };
  
  cancelButton.onclick = () => {
    dialog.classList.remove('show');
    if (onCancel) onCancel();
  };
}

function updateSliderVisual(sliderId) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const value = parseInt(slider.value);
  const percent = ((value - min) / (max - min)) * 100;
  
  slider.style.background = `linear-gradient(to right, 
                            var(--primary-color) 0%, 
                            var(--primary-color) ${percent}%, 
                            var(--card-bg) ${percent}%, 
                            var(--card-bg) 100%)`;
}

function updateAllSliderVisuals() {
  const sliders = document.querySelectorAll('input[type="range"]');
  
  sliders.forEach(slider => {
    const min = parseInt(slider.min);
    const max = parseInt(slider.max);
    const value = parseInt(slider.value);
    const percent = ((value - min) / (max - min)) * 100;
    
    slider.style.background = `linear-gradient(to right, 
                              var(--primary-color) 0%, 
                              var(--primary-color) ${percent}%, 
                              var(--card-bg) ${percent}%, 
                              var(--card-bg) 100%)`;
  });
}

function connectSliderWithInput(sliderId, inputId, updateCallback = null) {
  const slider = document.getElementById(sliderId);
  const input = document.getElementById(inputId);
  
  if (!slider || !input) return;
  
  slider.addEventListener('input', function() {
    input.value = this.value;
    updateSliderVisual(sliderId);
    
    if (updateCallback) updateCallback(this.value);
  });
  
  input.addEventListener('input', function() {
    let value = parseInt(this.value);
    const min = parseInt(slider.min);
    const max = parseInt(slider.max);
    
    if (isNaN(value)) value = min;
    if (value < min) value = min;
    if (value > max) value = max;
    
    slider.value = value;
    updateSliderVisual(sliderId);
    
    if (updateCallback) updateCallback(value);
  });
  
  input.addEventListener('blur', function() {
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
    
    if (updateCallback) updateCallback(value);
  });
  
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      this.blur();
      e.preventDefault();
    }
  });
}

function updateSliderProgress() {
  const sliderProgressContainers = document.querySelectorAll('.slider-progress');
  
  sliderProgressContainers.forEach(container => {
    const slider = container.querySelector('input[type="range"]');
    const min = parseInt(container.getAttribute('data-min') || slider.min);
    const max = parseInt(container.getAttribute('data-max') || slider.max);
    const value = parseInt(container.getAttribute('data-value') || slider.value);
    
    const percent = ((value - min) / (max - min)) * 100;
    
    slider.style.background = `linear-gradient(to right, 
                              var(--primary-color) 0%, 
                              var(--primary-color) ${percent}%, 
                              var(--card-bg) ${percent}%, 
                              var(--card-bg) 100%)`;
    
    const sliderIdParts = slider.id.split('Slider');
    const inputId = `${sliderIdParts[0]}ValueInput`;
    const input = document.getElementById(inputId);
    
    if (input) {
      input.value = slider.value;
    }
  });
}
