import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the built app be served from any sub-path (e.g. a preview host).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as never);
