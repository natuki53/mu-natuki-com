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

  const langGroup = document.getElementById('lang-toggle');
  const langOptions = langGroup?.querySelectorAll('.segment-option[data-lang]');
  const savedLang = localStorage.getItem('lang') || 'ja';
  html.setAttribute('lang', savedLang);
  applyTranslations(savedLang);

  const setLangUi = (lang) => {
    langOptions?.forEach((btn) => {
      const value = btn.getAttribute('data-lang');
      btn.setAttribute('aria-pressed', value === lang ? 'true' : 'false');
    });
  };
  setLangUi(savedLang);

  const toastEl = document.getElementById('toast');
  const toastMessages = { en: en['toast.switchedToEn'], ja: '日本語に変更しました' };

  const showToast = (message) => {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 2500);
  };

  langOptions?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      if (btn.getAttribute('aria-pressed') === 'true') return;
      localStorage.setItem('lang', lang);
      html.setAttribute('lang', lang);
      applyTranslations(lang);
      setLangUi(lang);
      window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
      showToast(toastMessages[lang]);
    });
  });
};

// Export for use by modal
export { en };
