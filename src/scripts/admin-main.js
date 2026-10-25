import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initAdminPage } from './admin-page.js';
import { renderAdminIcons } from './admin-icons.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initI18n();
  renderAdminIcons();
  initAdminPage();

  const footerYear = document.getElementById('footer-year');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
});
