import { en } from '../data/english.js';
import { WEB_APP_STATUS_POLL_MS } from '../config/web-app-status.js';
import { reportServiceStatus } from './overall-status.js';
import {
  fetchWebAppStatusSnapshot,
  isWebAppSnapshotFresh,
} from './web-app-status-api.js';

const JA = {
  'webApp.stateOnline': '稼働中',
  'webApp.stateDegraded': '一部障害',
  'webApp.stateOffline': '停止中',
  'webApp.stateUnknown': '確認不可',
  'webApp.loading': 'Webアプリの状態を読み込み中…',
  'webApp.fetchError': 'Webアプリの状態を取得できませんでした。',
  'webApp.stale': 'Webアプリの更新情報が古い可能性があります。',
  'webApp.updatedPrefix': '最終確認',
};

function currentLang() {
  return document.documentElement.getAttribute('lang') || 'ja';
}

function t(key) {
  return currentLang() === 'en' ? en[key] : JA[key] ?? en[key];
}

function stateLabel(state) {
  if (state === 'online') return t('webApp.stateOnline');
  if (state === 'degraded') return t('webApp.stateDegraded');
  if (state === 'offline') return t('webApp.stateOffline');
  return t('webApp.stateUnknown');
}

function formatTime(value) {
  if (!value) return '—';
  return value.toLocaleString(currentLang() === 'en' ? 'en-US' : 'ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function setText(element, value) {
  if (element) element.textContent = value;
}

export const initWebAppStatusPage = () => {
  const root = document.getElementById('web-app-status-root');
  if (!root) return;

  const updateStatus = document.getElementById('web-app-status-updated');
  const appCards = [...root.querySelectorAll('[data-app-id]')];
  let lastSnapshot = null;
  let refreshing = false;
  let consecutiveFailures = 0;
  let retryAt = 0;
  let fetchFailed = false;

  const renderApp = (card, app) => {
    const state = app?.state ?? 'unknown';
    card.dataset.state = state;
    setText(card.querySelector('[data-app-state]'), stateLabel(state));
    setText(
      card.querySelector('[data-app-http]'),
      app?.httpStatus == null ? '—' : `HTTP ${app.httpStatus}`,
    );
    setText(
      card.querySelector('[data-app-response-time]'),
      app?.responseTimeMs == null ? '—' : `${Math.round(app.responseTimeMs)} ms`,
    );
    setText(card.querySelector('[data-app-checked]'), formatTime(app?.lastCheckedAt));
  };

  const render = () => {
    if (!lastSnapshot) {
      setText(updateStatus, fetchFailed ? t('webApp.fetchError') : t('webApp.loading'));
      appCards.forEach((card) => renderApp(card, null));
      if (fetchFailed) reportServiceStatus('web-apps', 'unavailable');
      return;
    }

    const fresh = isWebAppSnapshotFresh(lastSnapshot);
    setText(
      updateStatus,
      fresh
        ? `${t('webApp.updatedPrefix')} ${formatTime(lastSnapshot.measuredAt)}`
        : t('webApp.stale'),
    );
    appCards.forEach((card) => {
      const app = lastSnapshot.apps.find((candidate) => candidate.id === card.dataset.appId);
      renderApp(card, app);
    });
    reportServiceStatus(
      'web-apps',
      fresh ? lastSnapshot.status : 'unavailable',
      lastSnapshot.measuredAt,
    );
  };

  const refresh = async () => {
    if (refreshing || Date.now() < retryAt) return;
    refreshing = true;
    root.setAttribute('aria-busy', 'true');
    try {
      lastSnapshot = await fetchWebAppStatusSnapshot();
      fetchFailed = false;
      consecutiveFailures = 0;
      retryAt = 0;
    } catch {
      fetchFailed = true;
      consecutiveFailures += 1;
      retryAt =
        Date.now() +
        Math.min(120_000, WEB_APP_STATUS_POLL_MS * 2 ** Math.min(consecutiveFailures, 2));
    } finally {
      refreshing = false;
      root.setAttribute('aria-busy', 'false');
      render();
    }
  };

  window.addEventListener('langchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  render();
  refresh();
  window.setInterval(refresh, WEB_APP_STATUS_POLL_MS);
};
