import {
  BOT_STATUS_FRESHNESS_MS,
  BOT_STATUS_REQUEST_TIMEOUT_MS,
  BOT_STATUS_URL,
} from '../config/bot-status.js';

const BOT_STATES = new Set(['online', 'degraded', 'offline', 'unknown']);
const OVERALL_STATES = new Set(['operational', 'degraded', 'outage', 'unavailable']);

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function dateValue(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDependency(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    !BOT_STATES.has(value.state)
  ) {
    return null;
  }
  return {
    id: value.id,
    displayName: value.displayName,
    state: value.state,
  };
}

function parseBot(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    !BOT_STATES.has(value.state)
  ) {
    return null;
  }

  const dependencies = Array.isArray(value.dependencies)
    ? value.dependencies.map(parseDependency).filter(Boolean)
    : [];

  return {
    id: value.id,
    displayName: value.displayName,
    state: value.state,
    uptimeSeconds: finiteNonNegative(value.uptimeSeconds),
    discordConnected:
      typeof value.discordConnected === 'boolean' ? value.discordConnected : null,
    gatewayLatencyMs: finiteNonNegative(value.gatewayLatencyMs),
    lastHeartbeatAt: dateValue(value.lastHeartbeatAt),
    dependencies,
  };
}

export function parseBotStatusSnapshot(value) {
  const measuredAt = dateValue(value?.measuredAt);
  if (
    !value ||
    typeof value !== 'object' ||
    value.version !== 1 ||
    !OVERALL_STATES.has(value.status) ||
    !Array.isArray(value.bots) ||
    !measuredAt
  ) {
    return null;
  }

  const bots = value.bots.map(parseBot).filter(Boolean);
  if (!bots.length) return null;

  return {
    status: value.status,
    measuredAt,
    bots,
  };
}

export function isBotSnapshotFresh(snapshot, now = Date.now()) {
  if (!snapshot?.measuredAt) return false;
  const age = now - snapshot.measuredAt.getTime();
  return age >= -5_000 && age <= BOT_STATUS_FRESHNESS_MS;
}

export async function fetchBotStatusSnapshot() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), BOT_STATUS_REQUEST_TIMEOUT_MS);
  const url = new URL(BOT_STATUS_URL, window.location.origin);
  url.searchParams.set('_', String(Date.now()));

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Bot status snapshot returned ${response.status}`);

    const snapshot = parseBotStatusSnapshot(await response.json());
    if (!snapshot) throw new Error('Bot status snapshot has an invalid schema');
    return snapshot;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
