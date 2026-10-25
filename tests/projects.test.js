import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { projects } from '../src/data/projects.js';

const expectedProjectOrder = [
  'vrnavi',
  'facemixer',
  'vrcosme-web',
  'vrcosme',
  'cliprack',
  '360-viewer',
  'toc-ad',
  'campustrade',
  'timecard',
];

test('project data follows the intended display order', () => {
  assert.deepEqual(
    projects.map((project) => project.id),
    expectedProjectOrder,
  );
});

test('home page project cards match the project data order', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const cardOrder = [...html.matchAll(/<a class="project-card[^"]*" href="\/projects\/([^/]+)\/">/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(cardOrder, expectedProjectOrder);
});
