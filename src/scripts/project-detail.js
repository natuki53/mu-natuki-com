import '../styles/main.css';
import { projects } from '../data/projects.js';
import { en } from '../data/english.js';
import { initProjectMenu } from './project-menu.js';
import { initTheme } from './theme.js';

const JA = {
  'project.detail.back': 'プロジェクト一覧へ',
  'project.detail.overview': '概要',
  'project.detail.facts': '数字と特徴',
  'project.detail.highlights': 'このプロジェクトのポイント',
  'project.detail.gallery': '画面と仕上がり',
  'project.detail.technology': '使用技術',
  'project.detail.links': '関連リンク',
  'project.detail.notFoundTitle': 'プロジェクトが見つかりません',
  'project.detail.notFoundText': '指定されたプロジェクトページは存在しません。',
  'footer.text': 'VRChatとWebを中心に、制作と運営をしています。',
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const projectId = document.body.dataset.projectId;
const project = projects.find((item) => item.id === projectId);
const app = document.getElementById('app');
let projectMenu;

function translation(key, language, fallback = '') {
  if (language === 'en' && en[key] !== undefined) return en[key];
  return fallback || JA[key] || en[key] || '';
}

function localizedProject(language) {
  if (!project) return null;
  const prefix = `project.${project.id}`;

  return {
    ...project,
    title: translation(`${prefix}.title`, language, project.title),
    category: translation(`${prefix}.category`, language, project.category),
    summary: translation(`${prefix}.summary`, language, project.summary),
    description: translation(`${prefix}.description`, language, project.description),
    highlights: translation(`${prefix}.highlights`, language, project.highlights),
    facts: translation(`${prefix}.facts`, language, project.facts || []),
    gallery: translation(`${prefix}.gallery`, language, project.gallery || []),
  };
}

function renderShell() {
  app.innerHTML = `
    <a class="skip-link" href="#main-content">本文へ移動</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="site-brand" href="/" aria-label="ホームへ戻る">
          <span class="brand-title">雨苺なつき</span>
          <span class="brand-subtitle">PORTFOLIO</span>
        </a>
        <nav class="menu-nav" aria-label="ページナビゲーション">
          <div id="project-menu-host"></div>
        </nav>
        <div class="header-tools">
          <div id="theme-toggle" class="segment-group" role="group" aria-label="テーマを切り替え">
            <button type="button" class="segment-option" data-theme="light" aria-pressed="false" aria-label="ライトテーマ">☀</button>
            <button type="button" class="segment-option" data-theme="dark" aria-pressed="false" aria-label="ダークテーマ">☾</button>
          </div>
          <div id="lang-toggle" class="segment-group lang-segment" role="group" aria-label="言語を切り替え">
            <button type="button" class="segment-option" data-lang="ja" aria-pressed="false">JA</button>
            <button type="button" class="segment-option" data-lang="en" aria-pressed="false">EN</button>
          </div>
        </div>
      </div>
    </header>
    <div id="project-content"></div>
    <footer class="site-footer">
      <p>© <span id="footer-year">${new Date().getFullYear()}</span> Natuki</p>
      <p id="detail-footer-copy"></p>
    </footer>
  `;
}

function createMedia(item) {
  const container = document.createElement('div');
  container.className = 'detail-media';
  const media = item.media || (item.cover
    ? { type: 'image', src: item.cover.src, title: item.cover.alt }
    : null);

  if (!media) {
    container.classList.add('detail-media-placeholder');
    const category = document.createElement('span');
    category.textContent = item.category;
    const title = document.createElement('strong');
    title.textContent = item.title;
    container.append(category, title);
  } else if (media.type === 'video') {
    const video = document.createElement('video');
    video.src = media.src;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', media.title || `${item.title} video`);
    container.appendChild(video);
  } else if (media.type === 'iframe') {
    const iframe = document.createElement('iframe');
    iframe.src = media.src;
    iframe.title = media.title || `${item.title} preview`;
    iframe.loading = 'lazy';
    iframe.allow = 'fullscreen; web-share; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.setAttribute('allowfullscreen', '');
    container.appendChild(iframe);
  } else if (media.type === 'image') {
    const image = document.createElement('img');
    image.src = media.src;
    image.alt = media.title || `${item.title} image`;
    image.loading = 'lazy';
    container.appendChild(image);
  }

  return container;
}

function renderNotFound(language) {
  const content = document.getElementById('project-content');
  const title = translation('project.detail.notFoundTitle', language);
  const text = translation('project.detail.notFoundText', language);
  const back = translation('project.detail.back', language);

  document.title = `${title} | Natuki`;
  content.innerHTML = `
    <main id="main-content" class="project-detail-main not-found">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(text)}</p>
        <a class="button button-primary" href="/#projects">${escapeHtml(back)}</a>
      </div>
    </main>
  `;
}

function renderProject(language) {
  const item = localizedProject(language);
  if (!item) {
    renderNotFound(language);
    return;
  }

  const labels = {
    back: translation('project.detail.back', language),
    overview: translation('project.detail.overview', language),
    facts: translation('project.detail.facts', language),
    highlights: translation('project.detail.highlights', language),
    gallery: translation('project.detail.gallery', language),
    technology: translation('project.detail.technology', language),
    links: translation('project.detail.links', language),
  };

  const highlightItems = item.highlights
    .map((highlight) => `<li><span aria-hidden="true"></span>${escapeHtml(highlight)}</li>`)
    .join('');
  const tagItems = item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  const factItems = (item.facts || [])
    .map(
      (fact) => `
        <li>
          <strong>${escapeHtml(fact.value)}</strong>
          <span>${escapeHtml(fact.label)}</span>
        </li>
      `,
    )
    .join('');
  const coverMarkup = item.cover
    ? `
      <figure class="detail-cover">
        <img src="${escapeHtml(item.cover.src)}" alt="${escapeHtml(item.cover.alt || item.title)}" />
      </figure>
    `
    : '';
  const galleryItems = (item.gallery || [])
    .map(
      (image) => `
        <figure class="detail-gallery-item">
          <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || '')}" loading="lazy" />
          ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''}
        </figure>
      `,
    )
    .join('');
  const linkItems = item.links
    .map(
      (link) => `
        <a class="detail-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
          <span>${escapeHtml(link.label)}</span><span aria-hidden="true">↗</span>
        </a>
      `,
    )
    .join('');
  const content = document.getElementById('project-content');
  content.innerHTML = `
    <main id="main-content" class="project-detail-main">
      <a class="detail-back" href="/#projects"><span aria-hidden="true">←</span>${escapeHtml(labels.back)}</a>

      <section class="detail-hero${item.cover ? '' : ' detail-hero-no-cover'}">
        <div class="detail-hero-copy">
          <p class="project-category">${escapeHtml(item.category)}</p>
          <h1 class="detail-title">${escapeHtml(item.title)}</h1>
          <p class="detail-summary">${escapeHtml(item.summary)}</p>
        </div>
        ${coverMarkup}
      </section>

      ${
        factItems
          ? `
        <section class="detail-facts" aria-labelledby="detail-facts-heading">
          <h2 id="detail-facts-heading">${escapeHtml(labels.facts)}</h2>
          <ul>${factItems}</ul>
        </section>
      `
          : ''
      }

      <div class="detail-layout">
        <div class="detail-primary">
          <section class="detail-card detail-overview-card">
            <h2>${escapeHtml(labels.overview)}</h2>
            <p class="detail-description">${escapeHtml(item.description)}</p>
          </section>
          <div id="project-media-slot"></div>
        </div>

        <aside class="detail-side">
          <section class="detail-card detail-highlights-card">
            <h2>${escapeHtml(labels.highlights)}</h2>
            <ul class="detail-highlights">${highlightItems}</ul>
          </section>
          <section class="detail-card detail-technology-card">
            <h2>${escapeHtml(labels.technology)}</h2>
            <div class="tags">${tagItems}</div>
          </section>
          <section class="detail-card detail-links-card">
            <h2>${escapeHtml(labels.links)}</h2>
            <div class="detail-links">${linkItems}</div>
          </section>
        </aside>
      </div>

      ${
        galleryItems
          ? `
        <section class="detail-gallery">
          <h2>${escapeHtml(labels.gallery)}</h2>
          <div class="detail-gallery-grid">${galleryItems}</div>
        </section>
      `
          : ''
      }

    </main>
  `;

  const media = createMedia(item);
  if (media) document.getElementById('project-media-slot')?.appendChild(media);

  document.title = `${item.title} | Natuki`;
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) descriptionMeta.setAttribute('content', item.summary);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', `${item.title} | Natuki`);
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription) ogDescription.setAttribute('content', item.summary);
}

function applyLanguage(language) {
  document.documentElement.lang = language;
  localStorage.setItem('lang', language);
  renderProject(language);
  projectMenu?.setLanguage(language);

  document.querySelectorAll('.segment-option[data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.lang === language ? 'true' : 'false');
  });

  const footer = document.getElementById('detail-footer-copy');
  if (footer) footer.textContent = translation('footer.text', language);
}

document.body.classList.add('project-detail-page');
renderShell();
projectMenu = initProjectMenu({ currentProjectId: projectId });
initTheme();

document.querySelectorAll('.segment-option[data-lang]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    applyLanguage(button.dataset.lang);
  });
});

applyLanguage(localStorage.getItem('lang') || 'ja');
