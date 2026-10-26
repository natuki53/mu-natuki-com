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

test('code failures remain failed in CI history while infrastructure evidence is shown separately', () => {
  const run={repository:'owner/repo',id:42,name:'CI',status:'completed',conclusion:'failure'};
  const job={repository:'owner/repo',id:81,run_id:42,name:'Tests',status:'completed',conclusion:'failure'};
  const data={...ci,runs:[run],jobs:[job]};
  const html=renderCIContent(data,options);
  assert.match(html,/failure/);
  assert.match(html,/警告には含めていません/);
  job.failureCause={category:'infrastructure',message:'ディスク容量不足',messageEn:'Disk full'};
  assert.match(renderCIContent(data,options),/ディスク容量不足/);
});
