import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isWebAppSnapshotFresh,
  parseWebAppStatusSnapshot,
} from '../src/scripts/web-app-status-api.js';

const snapshotJson = {
  version: 1,
  status: 'operational',
  measuredAt: '2026-07-29T12:00:00Z',
  apps: [
    {
      id: 'neareats',
      displayName: 'NearEats',
      url: 'https://neareats.mu-natuki.com/',
      state: 'online',
      httpStatus: 200,
      responseTimeMs: 42,
      lastCheckedAt: '2026-07-29T12:00:00Z',
    },
  ],
};

test('parseWebAppStatusSnapshot accepts the fixed public schema', () => {
  const snapshot = parseWebAppStatusSnapshot(snapshotJson);
  assert.equal(snapshot.status, 'operational');
  assert.equal(snapshot.apps[0].id, 'neareats');
  assert.equal(snapshot.apps[0].httpStatus, 200);
});

test('parseWebAppStatusSnapshot rejects invalid versions, states, and URLs', () => {
  assert.equal(parseWebAppStatusSnapshot({ ...snapshotJson, version: 2 }), null);
  assert.equal(parseWebAppStatusSnapshot({ ...snapshotJson, measuredAt: null }), null);
  assert.equal(
    parseWebAppStatusSnapshot({
      ...snapshotJson,
      apps: [{ ...snapshotJson.apps[0], state: 'starting' }],
    }),
    null,
  );
  assert.equal(
    parseWebAppStatusSnapshot({
      ...snapshotJson,
      apps: [{ ...snapshotJson.apps[0], url: 'javascript:alert(1)' }],
    }),
    null,
  );
});

test('isWebAppSnapshotFresh applies the web app freshness window', () => {
  const snapshot = parseWebAppStatusSnapshot(snapshotJson);
  assert.equal(isWebAppSnapshotFresh(snapshot, Date.parse('2026-07-29T12:01:29Z')), true);
  assert.equal(isWebAppSnapshotFresh(snapshot, Date.parse('2026-07-29T12:01:31Z')), false);
});
