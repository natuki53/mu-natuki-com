import { en } from '../data/english.js';
import { SERVER_STATUS_POLL_MS, SERVER_STATUS_URL } from '../config/server-status.js';

const JA = {
  'server.stateChecking': '確認中',
  'server.stateOnline': '稼働中',
  'server.stateError': '取得不可',
  'server.statusLoading': '現在の計測値を読み込み中…',
  'server.statusError': '現在の計測値を取得できませんでした。',
  'server.statusPartial': '一部の計測値を取得できませんでした。',
  'server.statusMeasuredPrefix': '計測',
  'server.statusStale': '最新の計測値が古い可能性があります。',
  'server.days': '日',
};

const FRESHNESS_LIMIT_MS = Math.max(60_000, SERVER_STATUS_POLL_MS * 6);
const REQUEST_TIMEOUT_MS = Math.min(5_000, SERVER_STATUS_POLL_MS - 500);

function currentLang() {
  return document.documentElement.getAttribute('lang') || 'ja';
}

function t(key) {
  return currentLang() === 'en' ? en[key] : JA[key] ?? en[key];
}

function numberFormat(maximumFractionDigits = 1) {
  return new Intl.NumberFormat(currentLang() === 'en' ? 'en-US' : 'ja-JP', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function percentage(value) {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 100) : null;
}

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
}

function parseSnapshot(json) {
  if (!json || json.version !== 1 || !['ok', 'partial', 'unavailable'].includes(json.status)) {
    return null;
  }

  const measuredAt = typeof json.measuredAt === 'string' ? new Date(json.measuredAt) : null;
  const validMeasuredAt = measuredAt && !Number.isNaN(measuredAt.getTime()) ? measuredAt : null;

  return {
    status: json.status,
    cpu: percentage(json.cpuPct),
    ram: percentage(json.memoryPct),
    disk: percentage(json.diskPct),
    uptime: nonNegativeNumber(json.uptimeSeconds),
    measuredAt: validMeasuredAt,
  };
}

async function fetchSnapshot() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(SERVER_STATUS_URL, window.location.origin);
  url.searchParams.set('_', String(Date.now()));

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Status snapshot returned ${response.status}`);

    const snapshot = parseSnapshot(await response.json());
    if (!snapshot) throw new Error('Status snapshot has an invalid schema');
    return snapshot;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function setMetricTrack(track, value) {
  if (!track) return;
  const fill = track.querySelector('.server-metric-fill');
  const safeValue = value == null ? 0 : clamp(value, 0, 100);
  if (fill) fill.style.width = `${safeValue}%`;
  track.setAttribute('aria-valuenow', String(Math.round(safeValue)));
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function formatUptime(seconds) {
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);

  if (currentLang() === 'en') return `${numberFormat(0).format(days)}d ${hours}h`;
  return `${numberFormat(0).format(days)}${t('server.days')} ${hours}時間`;
}

function isFresh(measuredAt) {
  if (!measuredAt) return false;
  const age = Date.now() - measuredAt.getTime();
  return age >= -5_000 && age <= FRESHNESS_LIMIT_MS;
}

export const initServerMetrics = () => {
  const root = document.getElementById('server-metrics-root');
  if (!root) return;

  const elements = {
    cpuTrack: document.getElementById('metric-cpu-track'),
    cpuValue: document.getElementById('metric-cpu-val'),
    ramTrack: document.getElementById('metric-ram-track'),
    ramValue: document.getElementById('metric-ram-val'),
    diskTrack: document.getElementById('metric-disk-track'),
    diskValue: document.getElementById('metric-disk-val'),
    uptimeValue: document.getElementById('metric-uptime-val'),
    status: document.getElementById('server-metrics-status'),
    partial: document.getElementById('server-metrics-partial'),
    state: document.getElementById('server-state'),
  };

  let lastSnapshot = null;
  let refreshing = false;

  const applySnapshot = (snapshot) => {
    lastSnapshot = snapshot;
    const formatter = numberFormat(1);

    setMetricTrack(elements.cpuTrack, snapshot.cpu);
    setText(elements.cpuValue, snapshot.cpu == null ? '—' : `${formatter.format(snapshot.cpu)}%`);

    setMetricTrack(elements.ramTrack, snapshot.ram);
    setText(elements.ramValue, snapshot.ram == null ? '—' : `${formatter.format(snapshot.ram)}%`);

    setMetricTrack(elements.diskTrack, snapshot.disk);
    setText(elements.diskValue, snapshot.disk == null ? '—' : `${formatter.format(snapshot.disk)}%`);

    setText(elements.uptimeValue, formatUptime(snapshot.uptime));
  };

  const setState = (kind) => {
    if (!elements.state) return;
    const label = elements.state.querySelector('span:last-child');
    elements.state.dataset.state = kind;

    if (kind === 'ok') setText(label, t('server.stateOnline'));
    else if (kind === 'error') setText(label, t('server.stateError'));
    else setText(label, t('server.stateChecking'));
  };

  const setStatus = (kind, measuredAt = null) => {
    if (!elements.status) return;
    elements.status.dataset.state = kind;

    if (kind === 'loading') {
      elements.status.textContent = t('server.statusLoading');
      return;
    }
    if (kind === 'error') {
      elements.status.textContent = t('server.statusError');
      return;
    }
    if (kind === 'stale') {
      elements.status.textContent = t('server.statusStale');
      return;
    }

    const measuredTime = measuredAt.toLocaleTimeString(currentLang() === 'en' ? 'en-US' : 'ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    elements.status.textContent = `${t('server.statusMeasuredPrefix')} ${measuredTime}`;
  };

  const showPartial = (show) => {
    if (!elements.partial) return;
    elements.partial.hidden = !show;
    if (show) elements.partial.textContent = t('server.statusPartial');
  };

  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    root.setAttribute('aria-busy', 'true');
    if (!lastSnapshot) {
      setState('loading');
      setStatus('loading');
    }
    showPartial(false);

    try {
      const snapshot = await fetchSnapshot();
      applySnapshot(snapshot);

      const availableValues = [snapshot.cpu, snapshot.ram, snapshot.disk, snapshot.uptime].filter(
        (value) => value != null,
      ).length;

      if (snapshot.status === 'unavailable' || availableValues === 0) {
        setState('error');
        setStatus('error');
        return;
      }

      setState('ok');
      showPartial(snapshot.status === 'partial' || availableValues < 4);
      setStatus(isFresh(snapshot.measuredAt) ? 'ok' : 'stale', snapshot.measuredAt);
    } catch {
      setState('error');
      setStatus('error');
    } finally {
      refreshing = false;
      root.setAttribute('aria-busy', 'false');
    }
  };

  const onLanguageChange = () => {
    if (lastSnapshot) applySnapshot(lastSnapshot);

    const state = elements.state?.dataset.state;
    setState(state === 'ok' || state === 'error' ? state : 'loading');

    const status = elements.status?.dataset.state;
    if (status === 'ok' && lastSnapshot?.measuredAt) setStatus('ok', lastSnapshot.measuredAt);
    else if (status === 'stale') setStatus('stale');
    else if (status === 'error') setStatus('error');
    else setStatus('loading');

    if (elements.partial && !elements.partial.hidden) {
      elements.partial.textContent = t('server.statusPartial');
    }
  };

  window.addEventListener('langchange', onLanguageChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  refresh();
  window.setInterval(refresh, SERVER_STATUS_POLL_MS);
};
