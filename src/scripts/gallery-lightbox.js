export const initGalleryLightbox = () => {
  const dialog = document.getElementById('gallery-lightbox');
  const modalImage = document.getElementById('gallery-lightbox-image');
  const modalCaption = document.getElementById('gallery-lightbox-caption');
  const closeButton = dialog?.querySelector('.gallery-lightbox-close');
  const triggers = document.querySelectorAll('.gallery-image-button');

  if (!dialog || !modalImage || !modalCaption || !closeButton || !triggers.length) return;

  let activeTrigger = null;

  const close = () => {
    if (dialog.open) dialog.close();
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.gallery-item');
      const image = item?.querySelector('img');
      const caption = item?.querySelector('figcaption');
      if (!image) return;

      activeTrigger = trigger;
      modalImage.src = image.currentSrc || image.src;
      modalImage.alt = image.alt;
      modalCaption.textContent = caption?.textContent.trim() || '';
      dialog.showModal();
    });
  });

  closeButton.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    modalImage.removeAttribute('src');
    activeTrigger?.focus();
    activeTrigger = null;
  });
};
