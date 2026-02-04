// Scroll reveal (IntersectionObserver)
export const initScrollReveal = () => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const markVisible = (el) => {
    el.classList.add('is-visible');
  };

  if (prefersReducedMotion) {
    // Ensure nothing stays hidden for users who prefer reduced motion
    document.querySelectorAll('.pop-in, .reveal, .reveal-fade').forEach(markVisible);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        markVisible(entry.target);
        observer.unobserve(entry.target);
      });
    },
    {
      root: null,
      threshold: 0.15,
      rootMargin: '0px 0px -10% 0px',
    }
  );

  // Check if element is already in viewport on page load
  const isInViewport = (el) => {
    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= windowHeight &&
      rect.right <= windowWidth
    );
  };

  const watch = (el, delayMs = 0) => {
    if (!el) return;
    el.style.setProperty('--reveal-delay', `${delayMs}ms`);

    if (isInViewport(el)) {
      markVisible(el);
    } else {
      observer.observe(el);
    }
  };

  // Sections already have .pop-in in HTML
  document.querySelectorAll('.pop-in').forEach((el, idx) => {
    watch(el, Math.min(idx * 80, 240));
  });

  // Sections with .reveal-fade (like card-panel)
  document.querySelectorAll('.reveal-fade').forEach((el, idx) => {
    if (!el.classList.contains('polaroid')) {
      watch(el, Math.min(idx * 80, 240));
    }
  });

  // Project cards: stagger
  const projectCards = Array.from(document.querySelectorAll('.project-card'));
  projectCards.forEach((el, idx) => {
    el.classList.add('reveal');
    watch(el, (idx % 3) * 90);
  });

  // Polaroids: keep existing rotation (no transform override)
  const polaroids = Array.from(document.querySelectorAll('.polaroid'));
  polaroids.forEach((polaroid, idx) => {
    polaroid.classList.add('reveal-fade');
    watch(polaroid, (idx % 2) * 100);

    const inner = polaroid.querySelector('.polaroid-inner');
    if (inner) {
      inner.classList.add('reveal');
      watch(inner, (idx % 2) * 100 + 80);
    }
  });

  // Link buttons: stagger
  const linkButtons = Array.from(document.querySelectorAll('.link-btn'));
  linkButtons.forEach((el, idx) => {
    el.classList.add('reveal');
    watch(el, Math.min(idx * 80, 320));
  });

  // Small texts that look nicer when they fade in
  const galleryDesc = document.querySelector('.gallery-desc');
  if (galleryDesc) {
    galleryDesc.classList.add('reveal');
    watch(galleryDesc, 0);
  }
};
