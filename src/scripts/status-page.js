import { en } from '../data/english.js';
import { BOT_STATUS_POLL_MS } from '../config/bot-status.js';
import {
  fetchBotStatusSnapshot,
  isBotSnapshotFresh,
} from './bot-status-api.js';
import { reportServiceStatus } from './overall-status.js';

const JA = {
  'bot.stateOnline': '稼働中',
  'bot.stateOffline': '停止中',
  'bot.stateUnknown': '確認不可',
  'bot.connectionOnline': '接続済み',
  'bot.connectionOffline': '未接続',
  'bot.connectionUnknown': '不明',
  'bot.updatedPrefix': '最終確認',
  'bot.loading': 'Botの状態を読み込み中…',
  'bot.fetchError': 'Botの状態を取得できませんでした。しばらくしてから再度お試しください。',
  'bot.stale': '最新の更新情報が古い可能性があります。',
  'bot.days': '日',
  'bot.hours': '時間',
  'bot.minutes': '分',
};

function currentLang() {
  return document.documentElement.getAttribute('lang') || 'ja';
}

function t(key) {
  return currentLang() === 'en' ? en[key] : JA[key] ?? en[key];
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function stateLabel(state) {
  if (state === 'online') return t('bot.stateOnline');
  if (state === 'degraded') return t('bot.stateDegraded');
  if (state === 'offline') return t('bot.stateOffline');
  return t('bot.stateUnknown');
}

function connectionLabel(value) {
  if (value === true) return t('bot.connectionOnline');
  if (value === false) return t('bot.connectionOffline');
  return t('bot.connectionUnknown');
}

function formatUptime(seconds) {
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (currentLang() === 'en') return `${days}d ${hours}h ${minutes}m`;
  return `${days}${t('bot.days')} ${hours}${t('bot.hours')} ${minutes}${t('bot.minutes')}`;
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

export const initBotStatusPage = () => {
  const root = document.getElementById('bot-status-root');
  if (!root) return;

  const updateStatus = document.getElementById('bot-section-status');
  const botCards = [...root.querySelectorAll('[data-bot-id]')];
  let lastSnapshot = null;
  let refreshing = false;
  let consecutiveFailures = 0;
  let retryAt = 0;
  let fetchFailed = false;

  const renderBot = (card, bot) => {
    const state = bot?.state ?? 'unknown';
    card.dataset.state = state;
    setText(card.querySelector('[data-bot-state]'), stateLabel(state));
    setText(card.querySelector('[data-bot-uptime]'), formatUptime(bot?.uptimeSeconds));
    setText(card.querySelector('[data-bot-discord]'), connectionLabel(bot?.discordConnected));
    setText(
      card.querySelector('[data-bot-latency]'),
      bot?.gatewayLatencyMs == null ? '—' : `${Math.round(bot.gatewayLatencyMs)} ms`,
    );
    setText(card.querySelector('[data-bot-updated]'), formatTime(bot?.lastHeartbeatAt));

    card.querySelectorAll('[data-dependency-id]').forEach((element) => {
      const dependency = bot?.dependencies.find(
        (candidate) => candidate.id === element.dataset.dependencyId,
      );
      const dependencyState = dependency?.state ?? 'unknown';
      element.dataset.state = dependencyState;
      setText(element.querySelector('[data-dependency-state]'), stateLabel(dependencyState));
    });
  };

  const render = () => {
    if (!lastSnapshot) {
      setText(updateStatus, fetchFailed ? t('bot.fetchError') : t('bot.loading'));
      botCards.forEach((card) => renderBot(card, null));
      if (fetchFailed) reportServiceStatus('bots', 'unavailable');
      return;
    }

    const fresh = isBotSnapshotFresh(lastSnapshot);
    const overallState = fresh ? lastSnapshot.status : 'unavailable';
    setText(
      updateStatus,
      fresh
        ? `${t('bot.updatedPrefix')} ${formatTime(lastSnapshot.measuredAt)}`
        : t('bot.stale'),
    );

    botCards.forEach((card) => {
      const bot = lastSnapshot.bots.find((candidate) => candidate.id === card.dataset.botId);
      renderBot(card, bot);
    });
    reportServiceStatus('bots', overallState, lastSnapshot.measuredAt);
  };

  const refresh = async () => {
    if (refreshing || Date.now() < retryAt) return;
    refreshing = true;
    root.setAttribute('aria-busy', 'true');
    try {
      lastSnapshot = await fetchBotStatusSnapshot();
      fetchFailed = false;
      consecutiveFailures = 0;
      retryAt = 0;
    } catch {
      fetchFailed = true;
      consecutiveFailures += 1;
      retryAt =
        Date.now() + Math.min(60_000, BOT_STATUS_POLL_MS * 2 ** Math.min(consecutiveFailures, 3));
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
  window.setInterval(refresh, BOT_STATUS_POLL_MS);
};
