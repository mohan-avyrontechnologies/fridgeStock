import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const DEV_JWT_SECRET = 'dev-only-secret-do-not-use-in-production';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  return DEV_JWT_SECRET;
}

/**
 * Web Push (VAPID) keys. Push is switched on only when all three are set;
 * without them, reminders still appear in the app. Only the public key is
 * ever sent to the client.
 */
function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/**
 * Claude API (Phase 4). AI features are on only when ANTHROPIC_API_KEY is set.
 * Tests never read the key, so no test can call the real API.
 */
function ai() {
  const apiKey = isTest ? '' : (process.env.ANTHROPIC_API_KEY ?? '');
  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
  return apiKey ? { apiKey, model } : null;
}

/**
 * Firebase Cloud Messaging, for push to the Android and iOS apps. On only when all three of the service
 * account's values are set. The private key is usually pasted with "\n" in place of its line breaks.
 */
function fcm() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  return projectId && clientEmail && privateKey ? { projectId, clientEmail, privateKey } : null;
}

/** Claude Sonnet 5.5; ID checked against Anthropic's models overview on 2026-09-30. */
export const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';

/** Everything the server reads from its environment. Secrets come only from here. */
export const env = {
  isProduction,
  isTest,
  port: Number(process.env.PORT ?? 4000),
  /** Empty in development means "use the embedded MongoDB". */
  mongoUri: process.env.MONGO_URI ?? '',
  jwtSecret: jwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  /** Browser origin(s) allowed by CORS; comma-separated for more than one. */
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** null when push isn't configured. */
  vapid: vapid(),
  /** null when AI features are off. */
  ai: ai(),
  /** null when push to the apps isn't configured. */
  fcm: fcm(),
  /** The iOS app's bundle id, sent as the APNs topic (optional). */
  apnsBundleId: process.env.APNS_BUNDLE_ID || null,
  /** Where this API is reached from outside, like https://api.example.com/api, so notification buttons in the apps can call it. */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  /** Photo Check feature flag (PHOTO_CHECK=on). Off by default; it also needs AI. */
  photoCheck: process.env.PHOTO_CHECK === 'on',
  /** Open Food Facts by default; the end-to-end tests point it at a local stand-in. */
  productLookupUrl: process.env.PRODUCT_LOOKUP_URL || 'https://world.openfoodfacts.org',
};
