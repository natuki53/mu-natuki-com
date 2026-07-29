/** Public, fixed-schema Discord bot status snapshot served from the same origin. */
export const BOT_STATUS_URL = '/api/bot-status.json';

/** Public dashboard refresh interval. */
export const BOT_STATUS_POLL_MS = 10_000;

/** Snapshot age after which the collector itself is considered stale. */
export const BOT_STATUS_FRESHNESS_MS = 30_000;

/** Abort slow public status requests without blocking the rest of the page. */
export const BOT_STATUS_REQUEST_TIMEOUT_MS = 2_500;
