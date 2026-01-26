// Main JavaScript entry point
import './style.css';
import { projects } from './projects.js';

console.log('Hello from mu-natuki.com!');

document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle?.querySelector('.theme-icon');
  const html = document.documentElement;

  // Load saved theme or default to light
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    html.setAttribute('data-theme', 'dark');
    if (themeIcon) themeIcon.textContent = '☀️';
  } else {
    html.removeAttribute('data-theme');
    if (themeIcon) themeIcon.textContent = '🌙';
  }

  // Toggle theme on button click
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = html.getAttribute('data-theme');
      if (currentTheme === 'dark') {
        html.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        if (themeIcon) themeIcon.textContent = '🌙';
      } else {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
      }
    });
  }

  // Modal Elements
  const modalOverlay = document.getElementById('project-modal');
  const modalCloseBtn = document.getElementById('modal-close');
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-desc');
  const modalTags = document.getElementById('modal-tags');
  const modalLinks = document.getElementById('modal-links');
  const modalMedia = document.getElementById('modal-media');

  const escapeHtml = (str) =>
    String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  // Allow only line breaks (<br>) in descriptions (also supports newline \n).
  const formatDescriptionHtml = (description) => {
    const escaped = escapeHtml(description ?? '');
    return escaped
      .replace(/\r?\n/g, '<br>')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  };

  // Helper to open modal
  const openModal = (projectId) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    modalTitle.textContent = project.title;
    modalDesc.innerHTML = formatDescriptionHtml(project.description);

    // Media Handling
    modalMedia.innerHTML = ''; // Clear previous
    modalMedia.className = 'modal-media-container hidden'; // Reset classes

    if (project.media) {
      modalMedia.classList.remove('hidden');
      if (project.media.type === 'video') {
        const video = document.createElement('video');
        video.src = project.media.src;
        video.controls = true;
        video.playsInline = true;
        // video.autoplay = true; // Optional
        modalMedia.appendChild(video);
      } else if (project.media.type === 'image') {
        const img = document.createElement('img');
        img.src = project.media.src;
        img.alt = project.media.alt || `${project.title} image`;
        img.loading = 'lazy';
        modalMedia.appendChild(img);
      } else if (project.media.type === 'iframe') {
        const iframe = document.createElement('iframe');
        iframe.src = project.media.src;
        // Allow fullscreen permissions
        iframe.allow = "fullscreen; web-share; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.setAttribute('allowfullscreen', ''); // Standard HTML5
        iframe.setAttribute('webkitallowfullscreen', ''); // WebKit
        iframe.setAttribute('mozallowfullscreen', ''); // Mozilla
        modalMedia.appendChild(iframe);
      }
    }

    // Clear and add tags
    modalTags.innerHTML = '';
    project.tags.forEach(tag => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = tag;
      modalTags.appendChild(span);
    });

    // Clear and add links
    modalLinks.innerHTML = '';
    // Remove previous layout classes and links-row class (which conflicts with grid layout)
    modalLinks.classList.remove('single-link', 'three-links', 'links-row');
    
    project.links.forEach(link => {
      const a = document.createElement('a');
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      // Determine style based on type
      let btnClass = 'link-btn';
      if (link.type === 'twitter') btnClass += ' twitter';
      if (link.type === 'booth') btnClass += ' booth';
      if (link.type === 'github') btnClass += ' github';
      // default/website stays white/blue

      a.className = btnClass;
      a.innerHTML = `<span class="icon">${getIconForType(link.type)}</span> ${link.label}`;
      modalLinks.appendChild(a);
    });

    // Apply layout class based on link count
    const linkCount = project.links.length;
    if (linkCount === 1) {
      modalLinks.classList.add('single-link');
    } else if (linkCount === 3) {
      modalLinks.classList.add('three-links');
    }

    modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent scrolling
  };

  // Helper to close modal
  const closeModal = () => {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = ''; // Restore scrolling
    // Clear media content to stop video/iframe playback
    setTimeout(() => {
      modalMedia.innerHTML = '';
    }, 300); // Wait for fade out
  };

  // Helper for icons
  const getIconForType = (type) => {
    const lowerType = type.toLowerCase();
    switch (lowerType) {
      case 'twitter': return 'X';
      case 'x': return 'X';
      case 'github': return '💻';
      case 'booth': return '🛍️';
      case 'youtube': return '🎥';
      case 'twitch': return '📺';
      case 'website': return '🔗';
      case 'extension': return '🧩';
      default: return '🔗';
    }
  };

  // Attach event listeners to projects
  const projectCards = document.querySelectorAll('.project-card');
  projectCards.forEach(card => {
    card.addEventListener('click', (e) => {
      // If clicking a link inside card (if any left), don't open modal? 
      // Current design has no links inside card, the card itself is the trigger.
      const projectId = card.getAttribute('data-id');
      if (projectId) {
        // Add a subtle click effect or just open
        openModal(projectId);
      }
    });

    // Add optional cursor effect
    card.style.cursor = 'pointer';
  });

  // Close listeners
  modalCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
      closeModal();
    }
  });

  // Scroll reveal (IntersectionObserver)
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const markVisible = (el) => {
    el.classList.add('is-visible');
  };

  const observeReveal = () => {
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
        // Trigger a little before the element fully enters
        rootMargin: '0px 0px -10% 0px',
      }
    );

    const watch = (el, delayMs = 0) => {
      if (!el) return;
      el.style.setProperty('--reveal-delay', `${delayMs}ms`);
      observer.observe(el);
    };

    // Sections already have .pop-in in HTML
    document.querySelectorAll('.pop-in').forEach((el, idx) => {
      watch(el, Math.min(idx * 80, 240));
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

  if (prefersReducedMotion) {
    // Ensure nothing stays hidden for users who prefer reduced motion
    document.querySelectorAll('.pop-in, .reveal, .reveal-fade').forEach(markVisible);
  } else {
    observeReveal();
  }
});
