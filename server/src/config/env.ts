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

export type AiProvider = 'anthropic' | 'gemini';

/** What a provider needs to make requests. null (see ai()) means AI features are off. */
export type AiConfig =
  | { provider: 'anthropic'; apiKey: string; model: string }
  | { provider: 'gemini'; apiKey: string; fastModel: string; smartModel: string; tier: 'free' | 'paid' };

/** Gemini models for the two tiers. Override with GEMINI_MODEL_FAST / GEMINI_MODEL_SMART. */
export const DEFAULT_GEMINI_MODEL_FAST = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_MODEL_SMART = 'gemini-2.5-pro';

/** Which AI provider to use: AI_PROVIDER, else Gemini in development and Claude in production. */
export function aiProviderFrom(value: string | undefined, production: boolean): AiProvider {
  const wanted = (value ?? '').trim().toLowerCase();
  if (wanted === '') return production ? 'anthropic' : 'gemini';
  if (wanted === 'anthropic' || wanted === 'gemini') return wanted;
  throw new Error(`AI_PROVIDER must be "anthropic" or "gemini" (got "${value}").`);
}

/**
 * The AI provider (Phase 4). AI features are on only when the chosen provider's key is set
 * (ANTHROPIC_API_KEY or GEMINI_API_KEY). Tests never read the keys, so no test can call a real API.
 */
function ai(): AiConfig | null {
  if (isTest) return null;
  const provider = aiProviderFrom(process.env.AI_PROVIDER, isProduction);
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      fastModel: process.env.GEMINI_MODEL_FAST || DEFAULT_GEMINI_MODEL_FAST,
      smartModel: process.env.GEMINI_MODEL_SMART || DEFAULT_GEMINI_MODEL_SMART,
      tier: process.env.GEMINI_TIER?.trim().toLowerCase() === 'paid' ? 'paid' : 'free',
    };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  return apiKey ? { provider, apiKey, model: process.env.AI_MODEL || DEFAULT_AI_MODEL } : null;
}

/**
 * Warnings to print when the server starts. A Gemini key is treated as free-tier unless GEMINI_TIER=paid,
 * and in production that is worth a warning: Google may use free-tier prompts (and the photos in them) to
 * improve its products.
 */
export function aiStartupWarnings(config: AiConfig | null, production: boolean): string[] {
  if (production && config?.provider === 'gemini' && config.tier !== 'paid') {
    return [
      'AI_PROVIDER=gemini is using a free-tier key in production. Google may use free-tier prompts, including photos, ' +
        'to improve its products. Use a paid key and set GEMINI_TIER=paid, or set AI_PROVIDER=anthropic.',
    ];
  }
  return [];
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

/**
 * Whether this server runs the scheduled jobs (the reminder sweep and photo clean-up). On by default. While a
 * second server shares the database (the Python server, during its fallback period), exactly one of them has
 * it on; see docs/PYTHON_MIGRATION.md. Anything other than an on/off word stops the server, so a typo can
 * never silently leave reminders unsent.
 */
export function jobsEnabledFrom(value: string | undefined): boolean {
  const wanted = (value ?? '').trim().toLowerCase();
  if (['', 'true', '1', 'on', 'yes'].includes(wanted)) return true;
  if (['false', '0', 'off', 'no'].includes(wanted)) return false;
  throw new Error(`JOBS_ENABLED must be "true" or "false" (got "${value}").`);
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
  /** Whether this server runs the scheduled jobs (JOBS_ENABLED, on by default). */
  jobsEnabled: jobsEnabledFrom(process.env.JOBS_ENABLED),
};
