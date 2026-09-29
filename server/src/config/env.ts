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

export const env = {
  isProduction,
  isTest,
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? '',
  jwtSecret: jwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  reminderSweepMinutes: Number(process.env.REMINDER_SWEEP_MINUTES ?? 15),
};
