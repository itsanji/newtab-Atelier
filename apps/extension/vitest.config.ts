import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'extension',
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
});
