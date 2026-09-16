// Theme Toggle (dark/light mode) - セグメントコントロール
export const initTheme = () => {
  const html = document.documentElement;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const group = document.getElementById('theme-toggle');
  const options = group?.querySelectorAll('.segment-option[data-theme]');
  if (!options?.length) return;

  const setTheme = (theme) => {
    const themeColor = theme === 'dark' ? '#1c1920' : '#faf8fb';
    if (theme === 'dark') {
      html.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
    html.style.colorScheme = theme;
    html.style.backgroundColor = themeColor;
    if (themeColorMeta) themeColorMeta.content = themeColor;
    options.forEach((btn) => {
      const value = btn.getAttribute('data-theme');
      btn.setAttribute('aria-pressed', value === theme ? 'true' : 'false');
    });
  };

  // 保存済みテーマがあればそれを使用、なければ端末の prefers-color-scheme に合わせる
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = localStorage.getItem('theme') ?? (prefersDark ? 'dark' : 'light');
  setTheme(initialTheme);

  options.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      if (btn.getAttribute('aria-pressed') === 'true') return;
      setTheme(theme);
    });
  });
};
