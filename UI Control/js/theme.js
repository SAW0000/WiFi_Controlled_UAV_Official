
function toggleTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');
  
  body.classList.toggle('light-theme');
  
  if (themeToggle) {
    themeToggle.checked = body.classList.contains('light-theme');
  }
  
  updateNavbarTheme(!body.classList.contains('light-theme'));
  
  localStorage.setItem('drone_theme', body.classList.contains('light-theme') ? 'light' : 'dark');
  
  const isLightTheme = body.classList.contains('light-theme');
  showNotification(
    isLightTheme ? 'تم تفعيل الوضع النهاري' : 'تم تفعيل الوضع الليلي',
    isLightTheme ? '☀️' : '🌙',
    'success',
    'theme'
  );
  
  saveSettingsToLocalStorage();
}

function updateNavbarTheme(isDarkTheme) {
  const navBackground = document.getElementById('navBackground');
  
  if (isDarkTheme) {
    navBackground.setAttribute('fill', '#1a1e2d');
    navBackground.setAttribute('filter', 'url(#darkNeumorphism)');
  } else {
    navBackground.setAttribute('fill', 'url(#lightGradient)');
    navBackground.setAttribute('filter', 'url(#single-shadow-out)');
  }
}