import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, unlink } from 'node:fs/promises';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

const projectIds = [
  'vrnavi',
  'facemixer',
  'vrcosme',
  'vrcosme-web',
  'cliprack',
  'campustrade',
  '360-viewer',
  'timecard',
  'toc-ad',
];

const projectEntries = Object.fromEntries(
  projectIds.map((id) => [`project-${id}`, resolve(rootDir, `projects/${id}/index.html`)]),
);

async function removeBackupFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return removeBackupFiles(path);
      if (entry.isFile() && entry.name.endsWith('.bak')) return unlink(path);
      return undefined;
    }),
  );
}

export default defineConfig({
  plugins: [
    {
      name: 'exclude-public-backups',
      apply: 'build',
      async closeBundle() {
        await removeBackupFiles(resolve(rootDir, 'dist'));
      },
    },
  ],
  server: {
    proxy: {
      '/api/server-status.json': {
        target: 'https://mu-natuki.com',
        changeOrigin: true,
        secure: true,
      },
      '/api/bot-status.json': {
        target: 'https://mu-natuki.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        status: resolve(rootDir, 'status/index.html'),
        ...projectEntries,
      },
    },
  },
});
