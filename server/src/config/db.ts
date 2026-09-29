import { mkdirSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { runMigrations } from '../models/migrations.js';
import { env } from './env.js';

async function resolveMongoUri(): Promise<string> {
  if (env.mongoUri) return env.mongoUri;
  if (env.isProduction) throw new Error('MONGO_URI must be set in production.');

  // Development fallback: an embedded MongoDB, so the app runs without Docker
  // or a local mongod install. mongodb-memory-server is a devDependency.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  if (process.env.EPHEMERAL_DB === '1') {
    // End-to-end runs: a throwaway database that never touches ./.data. It
    // lives in the project folder, not the OS temp folder, and is removed on exit.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const tmp = mkdtempSync(path.resolve('.test-db-'));
    const server = await MongoMemoryServer.create({ instance: { dbPath: tmp } });
    process.once('exit', () => rmSync(tmp, { recursive: true, force: true }));
    return `${server.getUri()}cook-first-e2e`;
  }
  const dbPath = path.resolve('.data');
  mkdirSync(dbPath, { recursive: true });
  const server = await MongoMemoryServer.create({
    instance: { dbPath, storageEngine: 'wiredTiger', port: 27027 },
  });
  console.log(`Using embedded MongoDB at ${server.getUri()} (data in ${dbPath})`);
  return `${server.getUri()}cook-first`;
}

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(await resolveMongoUri());
  await runMigrations();
}
