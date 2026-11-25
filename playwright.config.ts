import { defineConfig } from '@playwright/test';

const remote = process.env.PLAYWRIGHT_BASE_URL;
const local = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: remote || local,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: remote ? undefined : {
    command: 'bun run preview --host 127.0.0.1 --port 4173 --strictPort',
    url: local,
    reuseExistingServer: !process.env.CI,
  },
});
