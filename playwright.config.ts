import { defineConfig, devices } from '@playwright/test';
import webpush from 'web-push';

/**
 * End-to-end: real API (throwaway in-memory MongoDB) + real client, driven in
 * the locally installed Chrome, once at phone size and once at desktop size. Uses its own ports so
 * it never collides with a running dev setup.
 */
// Fresh Web Push keys for each run, so push is switched on without committing a key.
const vapid = webpush.generateVAPIDKeys();

const API_PORT = 4100;
const WEB_PORT = 5174;
const PRODUCTS_PORT = 4101;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  // Every journey runs on a phone and on a desktop screen.
  projects: [
    // A 375 px-wide phone (the narrowest common size), in Chromium.
    {
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['Pixel 7'].userAgent,
      },
    },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      // A stand-in for the product database, so barcode look-ups never reach the internet.
      command: 'node e2e/stub-products.mjs',
      url: `http://localhost:${PRODUCTS_PORT}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { STUB_PRODUCTS_PORT: String(PRODUCTS_PORT) },
    },
    {
      command: 'npx tsx --conditions=source src/index.ts',
      cwd: 'server',
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        EPHEMERAL_DB: '1',
        PRODUCT_LOOKUP_URL: `http://localhost:${PRODUCTS_PORT}`,
        // The journeys sign up more than 20 accounts from one IP; the limit itself is unit-tested (rules.test.ts).
        AUTH_RATE_LIMIT: 'off',
        // Never the real Claude API: an empty key keeps AI off even if server/.env has one
        // (dotenv doesn't override variables that are already set).
        ANTHROPIC_API_KEY: '',
        MONGO_URI: '',
        CLIENT_ORIGIN: `http://localhost:${WEB_PORT}`,
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: 'mailto:e2e@example.com',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'client',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/api` },
    },
  ],
});
