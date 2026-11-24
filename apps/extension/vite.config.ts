import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // An e2e build (ATELIER_E2E=1) goes to its own folder, so `dist` never carries the test host permission.
  build: { outDir: process.env.ATELIER_E2E === '1' ? 'dist-e2e' : 'dist', emptyOutDir: true },
});
