const MOBILE_QUERY = '(max-width: 720px)';

export const initMobileMenu = () => {
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.mobile-menu-toggle');
  const panel = document.getElementById('mobile-menu-panel');
  if (!header || !toggle || !panel) return;

  const media = window.matchMedia(MOBILE_QUERY);
  let open = false;

  const updateLabel = () => {
    const english = document.documentElement.lang === 'en';
    const labels = english
      ? { open: 'Open menu', close: 'Close menu' }
      : { open: 'メニューを開く', close: 'メニューを閉じる' };
    toggle.setAttribute('aria-label', open ? labels.close : labels.open);
  };

  const closeProjectDropdown = () => {
    panel.querySelectorAll('.menu-dropdown.is-open').forEach((dropdown) => {
      dropdown.classList.remove('is-open');
      dropdown.querySelector('.menu-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
    });
  };

  const setOpen = (nextOpen, returnFocus = false) => {
    open = media.matches && nextOpen;
    header.classList.toggle('is-menu-open', open);
    document.body.classList.toggle('mobile-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));

    if (media.matches) {
      panel.inert = !open;
      panel.setAttribute('aria-hidden', String(!open));
    } else {
      panel.inert = false;
      panel.removeAttribute('aria-hidden');
    }

    if (!open) closeProjectDropdown();
    updateLabel();
    if (returnFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => setOpen(!open));
  panel.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', (event) => {
    if (open && !header.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false, true);
  });
  if (media.addEventListener) {
    media.addEventListener('change', () => setOpen(false));
  } else {
    media.addListener(() => setOpen(false));
  }
  window.addEventListener('langchange', updateLabel);

  setOpen(false);
};
