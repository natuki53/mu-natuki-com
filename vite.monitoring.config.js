import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

// This preview sends every /api request to a loopback-only preview API (sample or live reader).
export default mergeConfig(base, defineConfig({
  server: { host: '127.0.0.1', port: 4178, strictPort: true, proxy: {
    '/api/admin/': { target: 'http://127.0.0.1:18765' },
    '/api/server-status.json': { target: 'http://127.0.0.1:18765', changeOrigin: false },
    '/api/bot-status.json': { target: 'http://127.0.0.1:18765', changeOrigin: false },
    '/api/web-app-status.json': { target: 'http://127.0.0.1:18765', changeOrigin: false },
  } },
}));
