import { initProjectMenu } from './project-menu.js';

// Global menu: smooth scroll & project dropdown
export const initMenu = () => {
  initProjectMenu();

  const scrollTargets = { top: 'top', projects: 'projects', profile: 'profile' };
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const scrollToSection = (id) => {
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      return;
    }

    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  document.querySelectorAll('[data-scroll]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const key = link.getAttribute('data-scroll');
      const id = scrollTargets[key] || key;
      scrollToSection(id);
    });
  });
};
