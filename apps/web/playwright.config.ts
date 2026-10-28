import { defineConfig, devices } from '@playwright/test';

const touch = { hasTouch: true, isMobile: true };

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5179',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    // Phase 5 (Implementation.md §13.10): the touch scenarios on a phone and a tablet.
    {
      name: 'phone',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], ...touch, viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablet',
      testMatch: /mobile\.spec\.ts/,
      use: { ...touch, viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --port 5179 --strictPort',
    // serve.spec.ts starts `archguide serve` on this port; Vite proxies /api and /ws to it.
    env: { ARCHGUIDE_SERVE: 'http://127.0.0.1:4399' },
    url: 'http://localhost:5179',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
