// Main JavaScript entry point
import '../styles/main.css';
import { initMenu } from './menu.js';
import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initModal } from './modal.js';
import { initScrollReveal } from './scroll-reveal.js';
import { initServerMetrics } from './metrics.js';

console.log('Hello from mu-natuki.com!');

document.addEventListener('DOMContentLoaded', () => {
  initMenu();
  initTheme();
  initI18n();
  initModal();
  initScrollReveal();
  initServerMetrics();
});
