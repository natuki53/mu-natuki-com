import { en } from '../data/english.js';
import { BOT_STATUS_POLL_MS } from '../config/bot-status.js';
import {
  fetchBotStatusSnapshot,
  isBotSnapshotFresh,
} from './bot-status-api.js';

const JA = {
  'bot.stateOnline': '稼働中',
  'bot.stateDegraded': '一部障害',
  'bot.stateOffline': '停止中',
  'bot.stateUnknown': '確認不可',
  'bot.summaryChecking': 'Botの状態を確認中…',
  'bot.summaryUnavailable': 'Botの状態を取得できませんでした。',
  'bot.summaryStale': 'Botの更新情報が古い可能性があります。',
  'bot.summaryCount': '{online}/{total} Bot 稼働中',
};

function currentLang() {
  return document.documentElement.getAttribute('lang') || 'ja';
}

function t(key) {
  return currentLang() === 'en' ? en[key] : JA[key] ?? en[key];
}

function stateLabel(state) {
  if (state === 'online') return t('bot.stateOnline');
  if (state === 'degraded') return t('bot.stateDegraded');
  if (state === 'offline') return t('bot.stateOffline');
  return t('bot.stateUnknown');
}

function setText(element, value) {
  if (element) element.textContent = value;
}

export const initBotSummary = () => {
  const root = document.getElementById('bot-summary-root');
  if (!root) return;

  const summary = document.getElementById('bot-summary-status');
  const botItems = [...root.querySelectorAll('[data-summary-bot]')];
  let lastSnapshot = null;
  let refreshing = false;
  let sectionNearby = false;
  let consecutiveFailures = 0;
  let retryAt = 0;
  let displayState = 'checking';

  const render = () => {
    if (!lastSnapshot) {
      root.dataset.state = displayState === 'error' ? 'unavailable' : 'checking';
      setText(
        summary,
        displayState === 'error' ? t('bot.summaryUnavailable') : t('bot.summaryChecking'),
      );
      botItems.forEach((item) => {
        item.dataset.state = 'unknown';
        setText(item.querySelector('[data-summary-state]'), stateLabel('unknown'));
      });
      return;
    }

    if (!isBotSnapshotFresh(lastSnapshot)) {
      root.dataset.state = 'unavailable';
      setText(summary, t('bot.summaryStale'));
    } else {
      root.dataset.state = lastSnapshot.status;
      const online = lastSnapshot.bots.filter((bot) => bot.state === 'online').length;
      setText(
        summary,
        t('bot.summaryCount')
          .replace('{online}', String(online))
          .replace('{total}', String(lastSnapshot.bots.length)),
      );
    }

    botItems.forEach((item) => {
      const bot = lastSnapshot.bots.find((candidate) => candidate.id === item.dataset.summaryBot);
      const state = bot?.state ?? 'unknown';
      item.dataset.state = state;
      setText(item.querySelector('[data-summary-state]'), stateLabel(state));
    });
  };

  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    root.setAttribute('aria-busy', 'true');
    try {
      lastSnapshot = await fetchBotStatusSnapshot();
      displayState = 'ready';
      consecutiveFailures = 0;
      retryAt = 0;
    } catch {
      consecutiveFailures += 1;
      retryAt =
        Date.now() + Math.min(60_000, BOT_STATUS_POLL_MS * 2 ** Math.min(consecutiveFailures, 3));
      displayState = 'error';
    } finally {
      refreshing = false;
      root.setAttribute('aria-busy', 'false');
      render();
    }
  };

  const refreshWhileVisible = () => {
    if (!sectionNearby || document.visibilityState !== 'visible' || Date.now() < retryAt) return;
    refresh();
  };

  window.addEventListener('langchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWhileVisible();
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        sectionNearby = entry.isIntersecting;
        if (sectionNearby) refreshWhileVisible();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(root);
  } else {
    sectionNearby = true;
    refreshWhileVisible();
  }

  render();
  window.setInterval(refreshWhileVisible, BOT_STATUS_POLL_MS);
};
