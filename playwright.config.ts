import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: real API (throwaway in-memory MongoDB) + real client, driven in
 * the locally installed Chrome at a phone-sized viewport. Uses its own ports so
 * it never collides with a running dev setup.
 */
const API_PORT = 4100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: 'server',
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        EPHEMERAL_DB: '1',
        MONGODB_URI: '',
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'client',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
