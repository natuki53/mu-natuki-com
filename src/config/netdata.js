/** Netdata HTTP API base (no trailing slash). Override with VITE_NETDATA_BASE_URL at build time. */
export const NETDATA_BASE_URL = (import.meta.env.VITE_NETDATA_BASE_URL || 'https://monitor.mu-natuki.com').replace(
  /\/$/,
  ''
);

/** Netdata メトリクス取得の間隔（固定・10秒） */
export const NETDATA_POLL_MS = 10_000;

/** Chart ids — adjust if your Netdata labels differ */
export const NETDATA_CHARTS = {
  cpu: 'system.cpu',
  ram: 'system.ram',
};
