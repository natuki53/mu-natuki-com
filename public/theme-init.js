(() => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let savedTheme = null;

  try {
    savedTheme = window.localStorage.getItem('theme');
  } catch {
    // localStorage が利用できない環境では端末設定を使用する
  }

  const theme = savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : (prefersDark ? 'dark' : 'light');
  const themeColor = theme === 'dark' ? '#1c1920' : '#faf8fb';

  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }

  root.style.colorScheme = theme;
  root.style.backgroundColor = themeColor;

  let themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta');
    themeColorMeta.name = 'theme-color';
    document.head.appendChild(themeColorMeta);
  }
  themeColorMeta.content = themeColor;
})();
