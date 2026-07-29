import {
  WEB_APP_STATUS_FRESHNESS_MS,
  WEB_APP_STATUS_REQUEST_TIMEOUT_MS,
  WEB_APP_STATUS_URL,
} from '../config/web-app-status.js';

const APP_STATES = new Set(['online', 'degraded', 'offline', 'unknown']);
const OVERALL_STATES = new Set(['operational', 'degraded', 'outage', 'unavailable']);

function dateValue(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function httpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function parseApp(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.url !== 'string' ||
    !APP_STATES.has(value.state)
  ) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value.url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;

  return {
    id: value.id,
    displayName: value.displayName,
    url: parsedUrl.toString(),
    state: value.state,
    httpStatus: httpStatus(value.httpStatus),
    responseTimeMs: finiteNonNegative(value.responseTimeMs),
    lastCheckedAt: dateValue(value.lastCheckedAt),
  };
}

export function parseWebAppStatusSnapshot(value) {
  const measuredAt = dateValue(value?.measuredAt);
  if (
    !value ||
    typeof value !== 'object' ||
    value.version !== 1 ||
    !OVERALL_STATES.has(value.status) ||
    !Array.isArray(value.apps) ||
    !measuredAt
  ) {
    return null;
  }

  const apps = value.apps.map(parseApp).filter(Boolean);
  if (!apps.length) return null;

  return {
    status: value.status,
    measuredAt,
    apps,
  };
}

export function isWebAppSnapshotFresh(snapshot, now = Date.now()) {
  if (!snapshot?.measuredAt) return false;
  const age = now - snapshot.measuredAt.getTime();
  return age >= -5_000 && age <= WEB_APP_STATUS_FRESHNESS_MS;
}

export async function fetchWebAppStatusSnapshot() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    WEB_APP_STATUS_REQUEST_TIMEOUT_MS,
  );
  const url = new URL(WEB_APP_STATUS_URL, window.location.origin);
  url.searchParams.set('_', String(Date.now()));

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Web app status snapshot returned ${response.status}`);

    const snapshot = parseWebAppStatusSnapshot(await response.json());
    if (!snapshot) throw new Error('Web app status snapshot has an invalid schema');
    return snapshot;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
