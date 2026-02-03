// Modal functionality
import { projects } from '../data/projects.js';
import { en } from '../data/english.js';

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

export const initModal = () => {
  // Modal Elements
  const modalOverlay = document.getElementById('project-modal');
  const modalCloseBtn = document.getElementById('modal-close');
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-desc');
  const modalTags = document.getElementById('modal-tags');
  const modalLinks = document.getElementById('modal-links');
  const modalMedia = document.getElementById('modal-media');

  // Helper to open modal
  const openModal = (projectId) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const lang = localStorage.getItem('lang') || 'ja';
    const titleKey = `project.${projectId}.title`;
    const descKey = `project.${projectId}.description`;
    const title = lang === 'en' && en[titleKey] ? en[titleKey] : project.title;
    const description = lang === 'en' && en[descKey] ? en[descKey] : project.description;

    modalTitle.textContent = title;
    modalDesc.innerHTML = lang === 'en' && en[descKey]
      ? en[descKey]
      : formatDescriptionHtml(description);

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
        iframe.allow = "fullscreen; web-share; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('webkitallowfullscreen', '');
        iframe.setAttribute('mozallowfullscreen', '');
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
    modalLinks.classList.remove('single-link', 'three-links', 'links-row');

    project.links.forEach(link => {
      const a = document.createElement('a');
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      let btnClass = 'link-btn';
      if (link.type === 'twitter') btnClass += ' twitter';
      if (link.type === 'booth') btnClass += ' booth';
      if (link.type === 'github') btnClass += ' github';

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
    document.body.style.overflow = 'hidden';
  };

  // Helper to close modal
  const closeModal = () => {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    setTimeout(() => {
      modalMedia.innerHTML = '';
    }, 300);
  };

  // Attach event listeners to projects
  const projectCards = document.querySelectorAll('.project-card');
  projectCards.forEach(card => {
    card.addEventListener('click', () => {
      const projectId = card.getAttribute('data-id');
      if (projectId) {
        openModal(projectId);
      }
    });
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
};
