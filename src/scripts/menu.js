// Global menu: smooth scroll & dropdown
export const initMenu = () => {
  const scrollTargets = { top: 'top', projects: 'projects', profile: 'profile' };
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  document.querySelectorAll('.menu-link[data-scroll], .dropdown-item[data-scroll]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const key = link.getAttribute('data-scroll');
      const id = scrollTargets[key] || key;
      scrollToSection(id);
      const dropdown = document.getElementById('works-dropdown');
      if (dropdown) dropdown.setAttribute('aria-expanded', 'false');
    });
  });

  const worksDropdown = document.getElementById('works-dropdown');
  const dropdownTrigger = worksDropdown?.querySelector('.menu-dropdown-trigger');
  if (dropdownTrigger) {
    dropdownTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      const expanded = worksDropdown.getAttribute('aria-expanded') === 'true';
      worksDropdown.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
  }

  document.addEventListener('click', (e) => {
    if (worksDropdown && !worksDropdown.contains(e.target)) {
      worksDropdown.setAttribute('aria-expanded', 'false');
    }
  });
};
