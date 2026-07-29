import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isBotSnapshotFresh,
  parseBotStatusSnapshot,
} from '../src/scripts/bot-status-api.js';

const snapshotJson = {
  version: 1,
  status: 'operational',
  measuredAt: '2026-07-29T12:00:00Z',
  bots: [
    {
      id: 'timecard',
      displayName: 'Timecard Bot',
      state: 'online',
      uptimeSeconds: 120,
      discordConnected: true,
      gatewayLatencyMs: 25,
      lastHeartbeatAt: '2026-07-29T12:00:00Z',
      dependencies: [],
    },
  ],
};

test('parseBotStatusSnapshot accepts the fixed public schema', () => {
  const snapshot = parseBotStatusSnapshot(snapshotJson);
  assert.equal(snapshot.status, 'operational');
  assert.equal(snapshot.bots[0].id, 'timecard');
  assert.equal(snapshot.bots[0].lastHeartbeatAt.toISOString(), '2026-07-29T12:00:00.000Z');
});

test('parseBotStatusSnapshot rejects unknown versions and states', () => {
  assert.equal(parseBotStatusSnapshot({ ...snapshotJson, version: 2 }), null);
  assert.equal(parseBotStatusSnapshot({ ...snapshotJson, status: 'secret' }), null);
  assert.equal(parseBotStatusSnapshot({ ...snapshotJson, measuredAt: null }), null);
  assert.equal(
    parseBotStatusSnapshot({
      ...snapshotJson,
      bots: [{ ...snapshotJson.bots[0], state: 'starting' }],
    }),
    null,
  );
});

test('isBotSnapshotFresh applies the collector freshness window', () => {
  const snapshot = parseBotStatusSnapshot(snapshotJson);
  assert.equal(isBotSnapshotFresh(snapshot, Date.parse('2026-07-29T12:00:29Z')), true);
  assert.equal(isBotSnapshotFresh(snapshot, Date.parse('2026-07-29T12:00:31Z')), false);
});
