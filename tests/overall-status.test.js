import test from 'node:test';
import assert from 'node:assert/strict';

import { combineServiceStates } from '../src/scripts/overall-status.js';

test('combineServiceStates combines bot and web app status conservatively', () => {
  assert.equal(combineServiceStates(['operational', 'operational']), 'operational');
  assert.equal(combineServiceStates(['operational', 'degraded']), 'degraded');
  assert.equal(combineServiceStates(['operational', 'unavailable']), 'degraded');
  assert.equal(combineServiceStates(['unavailable', 'unavailable']), 'unavailable');
  assert.equal(combineServiceStates(['degraded', 'outage']), 'outage');
});
