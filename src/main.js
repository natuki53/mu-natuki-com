// Main JavaScript entry point
import './style.css';

console.log('Hello from mu-natuki.com!');

// Add simple interaction or analytics here if needed
document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.link-card');

  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Optional: Add a subtle spotlight effect
      // card.style.setProperty('--mouse-x', `${x}px`);
      // card.style.setProperty('--mouse-y', `${y}px`);
    });
  });
});
