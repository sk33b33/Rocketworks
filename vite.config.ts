/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The Three.js vendor chunk is ~610 kB minified (~155 kB gzip) on its own.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: Three.js and React change rarely and cache well.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
