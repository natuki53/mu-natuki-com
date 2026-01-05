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

  // Helper to open modal
  const openModal = (projectId) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    modalTitle.textContent = project.title;
    modalDesc.textContent = project.description;

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
  };

  // Helper for icons
  const getIconForType = (type) => {
    switch (type) {
      case 'twitter': return 'X';
      case 'github': return '💻';
      case 'booth': return '🛍️';
      case 'twitch': return '📺';
      case 'website': return '🔗';
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
