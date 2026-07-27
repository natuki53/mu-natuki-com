import { projects } from '../data/projects.js';
import { en } from '../data/english.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const projectTitle = (project, language) =>
  language === 'en' ? en[`project.${project.id}.title`] || project.title : project.title;

export const initProjectMenu = ({ currentProjectId = '' } = {}) => {
  const host = document.getElementById('project-menu-host');
  if (!host) return null;

  const onHomePage = !currentProjectId;
  const initialLanguage = localStorage.getItem('lang') || 'ja';
  const projectItems = projects
    .map(
      (project) => `
        <a
          class="project-menu-item${project.id === currentProjectId ? ' is-current' : ''}"
          href="/projects/${escapeHtml(project.id)}/"
          data-project-menu-id="${escapeHtml(project.id)}"
          ${project.id === currentProjectId ? 'aria-current="page"' : ''}
        >
          <span class="project-menu-item-title">${escapeHtml(projectTitle(project, initialLanguage))}</span>
          <span aria-hidden="true">↗</span>
        </a>
      `,
    )
    .join('');

  host.innerHTML = `
    <div class="menu-dropdown" id="projects-dropdown">
      <button
        class="menu-link menu-dropdown-trigger"
        type="button"
        aria-expanded="false"
        aria-haspopup="true"
        aria-controls="project-menu-panel"
      >
        <span class="project-menu-trigger-label">Projects</span>
        <span class="menu-dropdown-chevron" aria-hidden="true"></span>
      </button>
      <div class="project-menu-panel" id="project-menu-panel" aria-label="プロジェクト">
        <a
          class="project-menu-overview"
          href="${onHomePage ? '#projects' : '/#projects'}"
          ${onHomePage ? 'data-scroll="projects"' : ''}
        >
          <span class="project-menu-overview-label"></span>
          <span aria-hidden="true">→</span>
        </a>
        <div class="project-menu-list">${projectItems}</div>
      </div>
    </div>
  `;

  const dropdown = host.querySelector('.menu-dropdown');
  const trigger = host.querySelector('.menu-dropdown-trigger');
  const panel = host.querySelector('.project-menu-panel');
  let closeTimer;

  const setOpen = (open) => {
    window.clearTimeout(closeTimer);
    dropdown.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  };

  const setLanguage = (language) => {
    const isEnglish = language === 'en';
    trigger.setAttribute(
      'aria-label',
      isEnglish ? 'Open projects menu' : 'プロジェクトメニューを開く',
    );
    panel.setAttribute('aria-label', isEnglish ? 'Projects' : 'プロジェクト');
    host.querySelector('.project-menu-overview-label').textContent = isEnglish
      ? 'All projects'
      : 'プロジェクト一覧';

    projects.forEach((project) => {
      const title = host.querySelector(`[data-project-menu-id="${project.id}"] .project-menu-item-title`);
      if (title) title.textContent = projectTitle(project, language);
    });
  };

  trigger.addEventListener('click', () => {
    setOpen(trigger.getAttribute('aria-expanded') !== 'true');
  });

  dropdown.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') setOpen(true);
  });
  dropdown.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') {
      closeTimer = window.setTimeout(() => setOpen(false), 100);
    }
  });
  dropdown.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!dropdown.contains(document.activeElement)) setOpen(false);
    }, 0);
  });
  panel.addEventListener('click', () => setOpen(false));

  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || trigger.getAttribute('aria-expanded') !== 'true') return;
    setOpen(false);
    trigger.focus();
  });
  window.addEventListener('langchange', (event) => {
    setLanguage(event.detail?.lang || 'ja');
  });

  setLanguage(initialLanguage);
  return { setLanguage, close: () => setOpen(false) };
};
