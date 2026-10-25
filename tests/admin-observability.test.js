import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, safeGithubUrl } from '../src/scripts/admin-observability.js';

test('missing disk measurements never render as zero bytes', () => {
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(undefined), '—');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024 ** 3), '1.0 GiB');
});
test('CI links are constrained to canonical GitHub repository runs', () => {
  assert.equal(safeGithubUrl('owner/repo', 42), 'https://github.com/owner/repo/actions/runs/42');
  for (const name of ['javascript:alert(1)', 'owner/repo/../../', 'owner/repo?x=1', 'example.com']) assert.equal(safeGithubUrl(name, 42), null);
  assert.equal(safeGithubUrl('owner/repo', '<script>'), null);
});
