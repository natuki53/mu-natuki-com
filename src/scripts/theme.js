// Theme Toggle (dark/light mode)
export const initTheme = () => {
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle?.querySelector('.theme-icon');

  // Load saved theme or default to light
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    html.setAttribute('data-theme', 'dark');
    if (themeIcon) themeIcon.textContent = '☀️';
  } else {
    html.removeAttribute('data-theme');
    if (themeIcon) themeIcon.textContent = '🌙';
  }

  // Toggle theme on button click
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = html.getAttribute('data-theme');
      if (currentTheme === 'dark') {
        html.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        if (themeIcon) themeIcon.textContent = '🌙';
      } else {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
      }
    });
  }
};
