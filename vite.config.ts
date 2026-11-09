import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } };

// base './' lets the built app be served from any sub-path (e.g. a preview host).
// /api goes to the Paintrest server (server/main.ts), which holds the AI key.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
  test: { environment: 'node' },
} as never);
