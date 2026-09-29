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
};
