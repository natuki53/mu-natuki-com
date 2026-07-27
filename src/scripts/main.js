// Main JavaScript entry point
import { initMenu } from './menu.js';
import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initScrollReveal } from './scroll-reveal.js';
import { initServerMetrics } from './metrics.js';

document.addEventListener('DOMContentLoaded', () => {
  initMenu();
  initTheme();
  initI18n();
  initScrollReveal();
  initServerMetrics();

  const footerYear = document.getElementById('footer-year');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
});
