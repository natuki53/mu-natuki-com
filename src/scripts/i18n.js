// Language (i18n) toggle
import { en } from '../data/english.js';

export const initI18n = () => {
  const html = document.documentElement;
  const defaultTexts = {};
  const defaultAria = {};

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    defaultTexts[el.dataset.i18n] = el.textContent;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    defaultTexts[el.dataset.i18nHtml] = el.innerHTML;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    defaultAria[el.dataset.i18nAria] = el.getAttribute('aria-label') ?? '';
  });

  const applyTranslations = (lang) => {
    const t = lang === 'en' ? en : defaultTexts;
    const a = lang === 'en' ? en : defaultAria;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      const value = t[key];
      if (value !== undefined) el.textContent = value;
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.dataset.i18nHtml;
      const value = t[key];
      if (value !== undefined) el.innerHTML = value;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.dataset.i18nAria;
      const value = a[key];
      if (value !== undefined) el.setAttribute('aria-label', value);
    });
  };

  const langToggle = document.getElementById('lang-toggle');
  const langLabel = document.querySelector('.lang-label');
  const savedLang = localStorage.getItem('lang') || 'ja';
  html.setAttribute('lang', savedLang);
  applyTranslations(savedLang);
  if (langLabel) langLabel.textContent = savedLang === 'en' ? en['lang.label'] : '日本語';

  if (langToggle) {
    langToggle.addEventListener('click', () => {
      const current = localStorage.getItem('lang') || 'ja';
      const next = current === 'ja' ? 'en' : 'ja';
      localStorage.setItem('lang', next);
      html.setAttribute('lang', next);
      applyTranslations(next);
      if (langLabel) langLabel.textContent = next === 'en' ? en['lang.label'] : '日本語';
    });
  }
};

// Export for use by modal
export { en };
