import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer;
let dbPath: string;

export async function setup() {
  // Keep the throwaway database inside the project (git-ignored) rather than
  // the OS temp folder, so a full system drive can't break the tests.
  dbPath = mkdtempSync(path.resolve('.test-db-'));
  server = await MongoMemoryServer.create({ instance: { dbPath } });
  process.env.TEST_MONGO_URI = server.getUri();
}

export async function teardown() {
  await server?.stop();
  rmSync(dbPath, { recursive: true, force: true });
}
