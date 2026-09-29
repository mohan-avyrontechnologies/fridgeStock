import mongoose from 'mongoose';
import path from 'node:path';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { UserModel } from './models/User.js';
import { sweep } from './services/notificationService.js';

async function resolveMongoUri(): Promise<string> {
  if (env.mongoUri) return env.mongoUri;
  if (env.isProduction) throw new Error('MONGODB_URI must be set in production.');

  // Development fallback: an embedded MongoDB persisted under ./.data, so the
  // app runs without Docker or a local mongod install.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  if (process.env.EPHEMERAL_DB === '1') {
    // End-to-end runs: a throwaway database that never touches ./.data.
    const server = await MongoMemoryServer.create();
    return `${server.getUri()}cook-first-e2e`;
  }
  const dbPath = path.resolve('.data');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dbPath, { recursive: true });
  const server = await MongoMemoryServer.create({
    instance: { dbPath, storageEngine: 'wiredTiger', port: 27027 },
  });
  console.log(`Using embedded MongoDB at ${server.getUri()} (data in ${dbPath})`);
  return `${server.getUri()}cook-first`;
}

async function main() {
  await mongoose.connect(await resolveMongoUri());
  const app = createApp();
  app.listen(env.port, () => console.log(`API listening on http://localhost:${env.port}/api`));

  const runSweep = () =>
    sweep((id) => UserModel.findById(id)).catch((err) => console.error('Reminder sweep failed', err));
  void runSweep();
  setInterval(runSweep, env.reminderSweepMinutes * 60 * 1000).unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
