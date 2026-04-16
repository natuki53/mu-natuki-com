import { en } from '../data/english.js';
import { NETDATA_BASE_URL, NETDATA_CHARTS, NETDATA_POLL_MS } from '../config/netdata.js';

const JA = {
  'server.statusLoading': '指標を読み込み中…',
  'server.statusError': '指標を取得できませんでした。しばらくしてから再度お試しください。',
  'server.statusPartial': '一部の指標のみ表示しています。',
  'server.statusUpdatedPrefix': '更新',
};

function currentLang() {
  return document.documentElement.getAttribute('lang') || 'ja';
}

function t(key) {
  return currentLang() === 'en' ? en[key] : JA[key] ?? en[key];
}

function nf(maxFrac = 1) {
  const lang = currentLang() === 'en' ? 'en-US' : 'ja-JP';
  return new Intl.NumberFormat(lang, { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 });
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function labelIndex(labels, name) {
  const i = labels.indexOf(name);
  return i === -1 ? null : i;
}

function dataUrl(chart, extra = {}) {
  const u = new URL('/api/v1/data', `${NETDATA_BASE_URL}/`);
  u.searchParams.set('chart', chart);
  u.searchParams.set('format', 'json');
  u.searchParams.set('points', '1');
  u.searchParams.set('group', 'average');
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  return u.toString();
}

async function fetchNetdataJson(url) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function lastRow(json) {
  const { labels, data } = json || {};
  if (!Array.isArray(labels) || !Array.isArray(data) || data.length === 0) return null;
  const row = data[data.length - 1];
  if (!Array.isArray(row) || row.length !== labels.length) return null;
  return { labels, row };
}

function parseCpuPct({ labels, row }) {
  const idleIdx = labelIndex(labels, 'idle');
  if (idleIdx != null && typeof row[idleIdx] === 'number') {
    return clamp(100 - row[idleIdx], 0, 100);
  }
  let sum = 0;
  for (let i = 1; i < row.length; i++) {
    const v = row[i];
    if (typeof v === 'number') sum += v;
  }
  return clamp(sum, 0, 100);
}

function parseRamPct({ labels, row }) {
  const keys = ['free', 'used', 'cached', 'buffers'];
  let total = 0;
  let used = null;
  for (const k of keys) {
    const idx = labelIndex(labels, k);
    if (idx == null || typeof row[idx] !== 'number') return null;
    if (k === 'used') used = row[idx];
    total += row[idx];
  }
  if (total <= 0 || used == null) return null;
  return clamp((100 * used) / total, 0, 100);
}

function setMetricTrack(trackEl, pct) {
  if (!trackEl) return;
  const fill = trackEl.querySelector('.server-metric-fill');
  const p = pct == null ? 0 : clamp(pct, 0, 100);
  if (fill) fill.style.width = `${p}%`;
  trackEl.setAttribute('aria-valuenow', String(Math.round(p)));
}

function setText(el, text) {
  if (el) el.textContent = text;
}

export const initServerMetrics = () => {
  const root = document.getElementById('server-metrics-root');
  if (!root) return;

  const els = {
    cpuTrack: document.getElementById('metric-cpu-track'),
    cpuVal: document.getElementById('metric-cpu-val'),
    ramTrack: document.getElementById('metric-ram-track'),
    ramVal: document.getElementById('metric-ram-val'),
    status: document.getElementById('server-metrics-status'),
    partial: document.getElementById('server-metrics-partial'),
  };

  let lastSnapshot = null;
  let lastUpdatedAt = null;

  const applySnapshot = (snap) => {
    lastSnapshot = snap;
    const fmt = nf(1);

    setMetricTrack(els.cpuTrack, snap.cpu);
    setText(els.cpuVal, snap.cpu == null ? '—' : `${fmt.format(snap.cpu)}%`);

    setMetricTrack(els.ramTrack, snap.ram);
    setText(els.ramVal, snap.ram == null ? '—' : `${fmt.format(snap.ram)}%`);
  };

  const setStatus = (kind) => {
    if (!els.status) return;
    if (kind === 'loading') {
      els.status.textContent = t('server.statusLoading');
      els.status.dataset.state = 'loading';
      return;
    }
    if (kind === 'error') {
      els.status.textContent = t('server.statusError');
      els.status.dataset.state = 'error';
      return;
    }
    if (kind === 'ok') {
      const d = lastUpdatedAt ?? new Date();
      const timeStr = d.toLocaleString(currentLang() === 'en' ? 'en-US' : 'ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      els.status.textContent = `${t('server.statusUpdatedPrefix')} ${timeStr}`;
      els.status.dataset.state = 'ok';
    }
  };

  const showPartial = (show) => {
    if (els.partial) {
      els.partial.hidden = !show;
      if (show) els.partial.textContent = t('server.statusPartial');
    }
  };

  const refresh = async () => {
    setStatus('loading');
    showPartial(false);
    root.setAttribute('aria-busy', 'true');

    const results = await Promise.allSettled([
      fetchNetdataJson(dataUrl(NETDATA_CHARTS.cpu)),
      fetchNetdataJson(dataUrl(NETDATA_CHARTS.ram)),
    ]);

    const snap = { cpu: null, ram: null };
    const chartKeys = ['cpu', 'ram'];
    let failures = 0;

    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') {
        failures += 1;
        return;
      }
      const lr = lastRow(r.value);
      if (!lr) {
        failures += 1;
        return;
      }
      const key = chartKeys[i];
      if (key === 'cpu') snap.cpu = parseCpuPct(lr);
      if (key === 'ram') snap.ram = parseRamPct(lr);
    });

    applySnapshot(snap);

    if (failures === 2) {
      setStatus('error');
    } else {
      lastUpdatedAt = new Date();
      setStatus('ok');
      showPartial(failures > 0);
    }

    root.setAttribute('aria-busy', 'false');
  };

  const onLang = () => {
    if (lastSnapshot) applySnapshot(lastSnapshot);
    const st = els.status?.dataset.state;
    if (st === 'loading') setStatus('loading');
    else if (st === 'error') setStatus('error');
    else if (st === 'ok') setStatus('ok');
    if (els.partial && !els.partial.hidden) els.partial.textContent = t('server.statusPartial');
  };

  window.addEventListener('langchange', onLang);

  refresh();
  window.setInterval(refresh, NETDATA_POLL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
};
