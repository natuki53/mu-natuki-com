import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initServerMetrics } from './metrics.js';
import { initBotStatusPage } from './status-page.js';
import { initProjectMenu } from './project-menu.js';
import { initMobileMenu } from './mobile-menu.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initI18n();
  initProjectMenu({ currentProjectId: 'status' });
  initMobileMenu();
  initServerMetrics();
  initBotStatusPage();

  const footerYear = document.getElementById('footer-year');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
});
