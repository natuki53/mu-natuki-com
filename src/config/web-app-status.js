/** Public snapshot for fixed, user-facing web applications. */
export const WEB_APP_STATUS_URL = '/api/web-app-status.json';

/** Public web apps are checked and refreshed every 30 seconds. */
export const WEB_APP_STATUS_POLL_MS = 30_000;

/** Treat the collector as unavailable if its snapshot stops updating. */
export const WEB_APP_STATUS_FRESHNESS_MS = 90_000;

/** Do not let an unavailable status endpoint block the rest of the page. */
export const WEB_APP_STATUS_REQUEST_TIMEOUT_MS = 5_000;
