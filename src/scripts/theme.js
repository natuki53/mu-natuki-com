// Theme Toggle (dark/light mode)
export const initTheme = () => {
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle?.querySelector('.theme-icon');

  // 保存済みテーマがあればそれを使用、なければ端末の prefers-color-scheme に合わせる
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = localStorage.getItem('theme') ?? (prefersDark ? 'dark' : 'light');
  if (initialTheme === 'dark') {
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
