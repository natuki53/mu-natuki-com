// Main JavaScript entry point
import './style.css';
import { projects } from './projects.js';

console.log('Hello from mu-natuki.com!');

document.addEventListener('DOMContentLoaded', () => {
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

    modalTitle.textContent = project.title;
    modalDesc.textContent = project.description;

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
});
