import { en } from '../data/english.js';

const JA = {
  'overall.loading': 'サービスの状態を読み込み中…',
  'overall.operational': 'すべて稼働中',
  'overall.degraded': '一部に問題があります',
  'overall.outage': 'サービスが停止しています',
  'overall.unavailable': '状態を確認できません',
  'overall.updatedPrefix': '最終確認',
};

const sources = new Map([
  ['bots', null],
  ['web-apps', null],
]);

let elements = null;

function currentLang() {
  return document.documentElement.getAttribute('lang') || 'ja';
}

function t(key) {
  return currentLang() === 'en' ? en[key] : JA[key] ?? en[key];
}

function formatTime(value) {
  if (!value) return '';
  return value.toLocaleString(currentLang() === 'en' ? 'en-US' : 'ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function combineServiceStates(states) {
  if (states.includes('outage')) return 'outage';
  if (states.every((state) => state === 'operational')) return 'operational';
  if (states.every((state) => state === 'unavailable')) return 'unavailable';
  return 'degraded';
}

function stateLabel(state) {
  if (state === 'operational') return t('overall.operational');
  if (state === 'degraded') return t('overall.degraded');
  if (state === 'outage') return t('overall.outage');
  return t('overall.unavailable');
}

function render() {
  if (!elements) return;
  const reports = [...sources.values()];
  if (reports.some((report) => report === null)) {
    elements.state.dataset.state = 'checking';
    elements.label.textContent = t('overall.loading');
    elements.updated.textContent = t('overall.loading');
    return;
  }

  const state = combineServiceStates(reports.map((report) => report.state));
  const measuredValues = reports
    .map((report) => report.measuredAt)
    .filter((value) => value instanceof Date);
  const oldestMeasurement = measuredValues.length
    ? new Date(Math.min(...measuredValues.map((value) => value.getTime())))
    : null;

  elements.state.dataset.state = state;
  elements.label.textContent = stateLabel(state);
  elements.updated.textContent = oldestMeasurement
    ? `${t('overall.updatedPrefix')} ${formatTime(oldestMeasurement)}`
    : stateLabel(state);
}

export function reportServiceStatus(source, state, measuredAt = null) {
  if (!sources.has(source)) return;
  sources.set(source, { state, measuredAt });
  render();
}

export const initOverallStatus = () => {
  const state = document.getElementById('service-overall-state');
  const label = document.getElementById('service-overall-label');
  const updated = document.getElementById('service-status-updated');
  if (!state || !label || !updated) return;

  elements = { state, label, updated };
  window.addEventListener('langchange', render);
  render();
};
