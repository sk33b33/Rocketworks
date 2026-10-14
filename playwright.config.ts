import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/*
 * End-to-end smoke suite, run headless against the production build (`npm run e2e` builds
 * first). WebGL runs on SwiftShader so no GPU is needed. A pre-installed Chromium is used when
 * PW_CHROMIUM_PATH (or the cloud default below) points at one; otherwise Playwright's own
 * browser is used (`npx playwright install chromium`).
 */

const PORT = 4180;
const preinstalled = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: existsSync(preinstalled) ? preinstalled : undefined,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
