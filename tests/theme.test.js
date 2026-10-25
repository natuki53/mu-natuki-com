import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const themeInitSource = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');

function runThemeInit({ savedTheme = null, prefersDark = false } = {}) {
  const attributes = new Map();
  const root = {
    style: {},
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
  const headChildren = [];
  const document = {
    documentElement: root,
    head: {
      appendChild(node) {
        headChildren.push(node);
      },
    },
    querySelector() {
      return headChildren.find((node) => node.name === 'theme-color') || null;
    },
    createElement() {
      return {};
    },
  };

  vm.runInNewContext(themeInitSource, {
    document,
    window: {
      localStorage: { getItem: () => savedTheme },
      matchMedia: () => ({ matches: prefersDark }),
    },
  });

  return { attributes, root, themeColorMeta: headChildren[0] };
}

test('saved dark theme is applied before the page renders', () => {
  const result = runThemeInit({ savedTheme: 'dark' });

  assert.equal(result.attributes.get('data-theme'), 'dark');
  assert.equal(result.root.style.colorScheme, 'dark');
  assert.equal(result.root.style.backgroundColor, '#1c1920');
  assert.equal(result.themeColorMeta.content, '#1c1920');
});

test('saved light theme overrides a dark system preference', () => {
  const result = runThemeInit({ savedTheme: 'light', prefersDark: true });

  assert.equal(result.attributes.has('data-theme'), false);
  assert.equal(result.root.style.colorScheme, 'light');
  assert.equal(result.root.style.backgroundColor, '#faf8fb');
  assert.equal(result.themeColorMeta.content, '#faf8fb');
});

test('every page loads the theme initializer before its stylesheet', async () => {
  const projectDirectories = await readdir(new URL('../projects/', import.meta.url), { withFileTypes: true });
  const htmlFiles = [
    new URL('../index.html', import.meta.url),
    new URL('../status/index.html', import.meta.url),
    new URL('../admin/index.html', import.meta.url),
    ...projectDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => new URL(`../projects/${entry.name}/index.html`, import.meta.url)),
  ];

  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, 'utf8');
    const initializerPosition = html.indexOf('<script src="/theme-init.js"></script>');
    const stylesheetPosition = html.indexOf('<link rel="stylesheet"');

    assert.notEqual(initializerPosition, -1, `${htmlFile.pathname} is missing theme-init.js`);
    assert.ok(initializerPosition < stylesheetPosition, `${htmlFile.pathname} loads the theme too late`);
  }
});
