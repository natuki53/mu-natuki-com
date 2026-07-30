import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initProjectMenu } from './project-menu.js';
import { initMobileMenu } from './mobile-menu.js';
import { initAdminPage } from './admin-page.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initI18n();
  initProjectMenu({ currentProjectId: 'admin' });
  initMobileMenu();
  initAdminPage();

  const footerYear = document.getElementById('footer-year');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
});
