#!/usr/bin/env node
/**
 * An embedded MongoDB for the Python server, so it runs with no Docker and no mongod install, like the
 * TypeScript server's (server/src/config/db.ts). It reuses mongodb-memory-server, already installed with the
 * repository's npm packages, which downloads and caches the same mongod binary.
 *
 *   node server-py/scripts/dev-mongo.mjs          (npm run db:py)
 *     Keeps its data in server-py/.data (gitignored) on port 27028, so accounts and food survive a restart.
 *     Port 27028 lets it run next to the TypeScript server's database on 27027.
 *
 *   node server-py/scripts/dev-mongo.mjs --empty  (npm run db:py:empty)
 *     Starts empty, for tests: a throwaway database in a new server-py/.test-db-* folder (gitignored) on a free
 *     port, deleted when it stops. It never touches server-py/.data.
 *
 * --data-dir <folder> and --port <port> move the persistent database (the tests use them to check that data
 * survives a restart without touching your own server-py/.data).
 *
 * Once ready it prints one line of JSON, {"uri": "mongodb://127.0.0.1:<port>/"}, for pytest or a person to
 * read. It stops on Ctrl+C, on SIGTERM, or when its standard input closes (how pytest stops it on Windows,
 * where a killed process gets no chance to clean up).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

const SERVER_PY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERSISTENT_PORT = 27028;
const empty = process.argv.includes('--empty');
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

let dbPath;
let instance;
if (empty) {
  dbPath = mkdtempSync(path.join(SERVER_PY, '.test-db-'));
  instance = { dbPath };
} else {
  dbPath = path.resolve(option('--data-dir') ?? path.join(SERVER_PY, '.data'));
  mkdirSync(dbPath, { recursive: true });
  instance = { dbPath, storageEngine: 'wiredTiger', port: Number(option('--port') ?? PERSISTENT_PORT) };
}

const server = await MongoMemoryServer.create({ instance });
console.log(JSON.stringify({ uri: server.getUri(), dbPath, empty }));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (!empty) {
    // Stopping mongod on Windows ends it at once, which can lose the last writes before they reach the disk.
    // Flushing them first means everything written before the stop is there after the next start.
    const client = await MongoClient.connect(server.getUri());
    await client.db('admin').command({ fsync: 1 });
    await client.close();
  }
  // The persistent database keeps its files; the empty one is deleted with its folder.
  await server.stop({ doCleanup: empty, force: false });
  if (empty) rmSync(dbPath, { recursive: true, force: true });
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.resume();
