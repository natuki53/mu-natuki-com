import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCIContent } from '../src/scripts/admin-ci.js';

const options = { text: (ja) => ja, esc: (v) => String(v ?? '').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), badge: (v) => v, date: () => 'time', empty: (v) => v, safeGithubUrl: () => null };
const ci = { runs: [], jobs: [], servers: [{ hostId: 'intel', name: 'Intel', state: 'offline', running: 0, maxJobs: 1, idle: 0, offline: 1, unknown: 0, available: 0, runners: [{ name: '<script>', state: 'offline', jobs: [] }] }] };
test('offline runners are explicitly inactive and cannot be mistaken for available slots', () => {
  const html = renderCIContent(ci, options);
  assert.match(html, /未稼働（オフライン）/);
  assert.match(html, /data-ci-capacity>0 <small>\/ 1/);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
});
test('API loss invalidates runner capacity instead of retaining a current zero or available value', () => {
  const html = renderCIContent(ci, { ...options, disconnected: true });
  assert.match(html, /data-ci-capacity>— <small>\/ 1/);
  assert.match(html, /状態不明/);
  assert.doesNotMatch(html, /未稼働（オフライン）|<meter/);
});
