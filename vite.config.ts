/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Three.js dominates the bundle (~900 kB min / 250 kB gzip); code-splitting is deferred.
  build: { chunkSizeWarningLimit: 1000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
