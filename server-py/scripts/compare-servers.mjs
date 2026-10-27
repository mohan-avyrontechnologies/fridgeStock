#!/usr/bin/env node
/**
 * Runs the same journey against the TypeScript server and the Python server, each on its own empty embedded
 * MongoDB, and reports every difference: in each response (status and body) and in the documents each server
 * leaves in the database. Ids, timestamps, tokens and password hashes differ by nature, so they are numbered in
 * the order they first appear instead.
 *
 *   node server-py/scripts/compare-servers.mjs
 *
 * It needs `npm install` at the root and `uv sync` in server-py. It exits with 1 if anything differs. Each phase
 * adds its routes to the journey; Phase 7's recorded contracts replace it.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'server', 'package.json'));
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const NODE_PORT = 4091;
const PYTHON_PORT = 4092;
const PYTHON = path.join(
  REPO,
  'server-py',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

const [mongoA, mongoB] = await Promise.all([MongoMemoryServer.create(), MongoMemoryServer.create()]);
const settings = { ...process.env, AUTH_RATE_LIMIT: 'off', JOBS_ENABLED: 'false', NODE_ENV: 'development' };
for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'VAPID_PUBLIC_KEY', 'FIREBASE_PROJECT_ID'])
  delete settings[key];
const servers = [
  spawn(process.execPath, [path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], {
    cwd: path.join(REPO, 'server'),
    env: { ...settings, PORT: String(NODE_PORT), MONGO_URI: `${mongoA.getUri()}fridgestock` },
  }),
  spawn(PYTHON, ['-m', 'server_py', '--host', '127.0.0.1'], {
    cwd: path.join(REPO, 'server-py'),
    env: { ...settings, PORT: String(PYTHON_PORT), MONGO_URI: `${mongoB.getUri()}fridgestock` },
  }),
];
let logs = '';
for (const server of servers) {
  server.stdout.on('data', () => {});
  server.stderr.on('data', (data) => (logs += data));
}

async function stop() {
  for (const server of servers) server.kill();
  await Promise.all([mongoA.stop(), mongoB.stop()]);
}

async function waitFor(port) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`The server on port ${port} never started.\n${logs}`);
}
await Promise.all([waitFor(NODE_PORT), waitFor(PYTHON_PORT)]);

/** Replaces ids, times, tokens and hashes with stable placeholders, numbered per server. */
function normaliser() {
  const ids = new Map();
  const norm = (value) => {
    if (typeof value === 'string') {
      if (/^[0-9a-f]{24}$/.test(value)) {
        if (!ids.has(value)) ids.set(value, `ID${ids.size}`);
        return ids.get(value);
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return 'TIME';
      if (/^eyJ/.test(value)) return 'TOKEN';
      if (/^\$2b\$12\$/.test(value)) return 'HASH';
      return value;
    }
    if (Array.isArray(value)) return value.map(norm);
    if (value instanceof Date) return 'TIME';
    if (value && typeof value === 'object') {
      if (value._bsontype === 'ObjectId') return norm(value.toHexString());
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, norm(item)]));
    }
    return value;
  };
  return norm;
}

const sides = [
  { port: NODE_PORT, norm: normaliser(), token: '', saved: {} },
  { port: PYTHON_PORT, norm: normaliser(), token: '', saved: {} },
];
let checked = 0;
let differences = 0;

async function send(side, method, url, body) {
  const headers = side.token ? { Authorization: `Bearer ${side.token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const target = url.replace(/\{(\w+)\}/g, (_, name) => side.saved[name]);
  const res = await fetch(`http://127.0.0.1:${side.port}${target}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

/** One request to both servers; `keep` saves the new item's id under that name for later urls. */
async function step(label, method, url, body, keep) {
  const results = await Promise.all(sides.map((side) => send(side, method, url, body)));
  results.forEach((res, i) => {
    if (res.body?.token) sides[i].token = res.body.token;
    if (keep) sides[i].saved[keep] = res.body?.id ?? res.body?.items?.[0]?.id;
  });
  const [a, b] = results.map((res, i) => JSON.stringify({ status: res.status, body: sides[i].norm(res.body) }));
  checked += 1;
  if (a !== b) {
    differences += 1;
    console.log(`DIFF ${label}\n  node:   ${a.slice(0, 1500)}\n  python: ${b.slice(0, 1500)}`);
  }
}

const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10);
const emoji = (n) => String.fromCodePoint(0x1f600).repeat(n);

// Phase 1: accounts.
await step('register', 'POST', '/api/auth/register', {
  name: 'Sam',
  email: 'sam@example.com',
  password: 'longenough',
  timeZone: 'UTC',
});
await step('me', 'GET', '/api/auth/me');
await step('rename', 'PUT', '/api/auth/me', { name: ' Samantha ', currency: 'GBP' });
await step('config', 'GET', '/api/push/config');
await step('ai status', 'GET', '/api/ai/status');

// Phase 2: food, history, favourites and learned lifespans.
await step(
  'milk set',
  'POST',
  '/api/foods',
  { name: 'Milk', quantity: 2, unit: 'l', lifespanDays: 7, notes: '  top shelf ', price: 2.4 },
  'milk',
);
await step('estimated', 'POST', '/api/foods', { name: 'Chicken breast', quantity: 500, unit: 'g' }, 'chicken');
await step('catalog', 'POST', '/api/foods', { name: 'milk', quantity: 1, unit: 'l' }, 'milk2');
await step(
  'printed date',
  'POST',
  '/api/foods',
  { name: 'Yoghurt', quantity: 4, unit: 'pcs', printedDate: day(5), printedDateType: 'USE_BY' },
  'yog',
);
await step('printed date too far', 'POST', '/api/foods', {
  name: 'Jam',
  quantity: 1,
  unit: 'pcs',
  printedDate: day(900),
});
await step('leftover', 'POST', '/api/foods', { name: 'Curry', quantity: 1, unit: 'pcs', leftover: true }, 'curry');
await step('leftover too long', 'POST', '/api/foods', {
  name: 'Curry',
  quantity: 1,
  unit: 'pcs',
  leftover: true,
  lifespanDays: 9,
});
await step('frozen leftover', 'POST', '/api/foods', {
  name: 'Stew',
  quantity: 1,
  unit: 'pcs',
  leftover: true,
  lifespanDays: 60,
  storage: 'FREEZER',
});
await step('category', 'POST', '/api/foods', { name: 'Mystery thing', quantity: 1, unit: 'pack', category: 'cheese' });
await step('opened', 'POST', '/api/foods', {
  name: 'Cream',
  quantity: 1,
  unit: 'ml',
  addedDate: day(-3),
  openedDate: day(-1),
});
await step('opened before added', 'POST', '/api/foods', {
  name: 'Cream',
  quantity: 1,
  unit: 'ml',
  addedDate: day(-3),
  openedDate: day(-4),
});
await step('added in the future', 'POST', '/api/foods', { name: 'Cream', quantity: 1, unit: 'ml', addedDate: day(1) });
await step('name past the model limit', 'POST', '/api/foods', {
  name: emoji(31),
  quantity: 1,
  unit: 'pcs',
  lifespanDays: 2,
});
await step('notes past the model limit', 'POST', '/api/foods', {
  name: 'Notes',
  quantity: 1,
  unit: 'pcs',
  lifespanDays: 2,
  notes: emoji(101),
});
await step('bad body', 'POST', '/api/foods', { name: '', quantity: 'x' });
await step('list', 'GET', '/api/foods');
await step('fridgestock', 'GET', '/api/foods/fridgestock');
await step('get', 'GET', '/api/foods/{milk}');
await step('get missing', 'GET', '/api/foods/000000000000000000000000');
await step('get bad id', 'GET', '/api/foods/xyz');
await step('get upper-case id', 'GET', '/api/foods/ABCDEF0123456789ABCDEF01');
await step('clear notes', 'PUT', '/api/foods/{milk}', { notes: '' });
await step('price and quantity', 'PUT', '/api/foods/{milk}', { price: 3.33, quantity: 3 });
await step('clear price', 'PUT', '/api/foods/{chicken}', { price: null });
await step('added date on a printed date', 'PUT', '/api/foods/{yog}', { addedDate: day(-2) });
await step('nothing to edit', 'PUT', '/api/foods/{milk}', { bogus: 1 });
await step('leftover lifespan', 'PUT', '/api/foods/{curry}', { lifespanDays: 10 });
await step('use part', 'POST', '/api/foods/{milk}/use', { quantity: 0.7 });
await step('use too much', 'POST', '/api/foods/{milk}/use', { quantity: 50 });
await step('use the rest', 'POST', '/api/foods/{milk}/use', {});
await step('use a closed item', 'POST', '/api/foods/{milk}/use', {});
await step('undo use', 'POST', '/api/foods/{milk}/undo');
await step('undo part', 'POST', '/api/foods/{milk}/undo');
await step('undo nothing', 'POST', '/api/foods/{milk}/undo');
await step('waste', 'POST', '/api/foods/{chicken}/waste', {});
await step('remove', 'DELETE', '/api/foods/{curry}');
await step('open', 'POST', '/api/foods/{milk2}/open', {});
await step('open again', 'POST', '/api/foods/{milk2}/open', {});
await step('undo open', 'DELETE', '/api/foods/{milk2}/open');
await step('undo open again', 'DELETE', '/api/foods/{milk2}/open');
await step('open with days', 'POST', '/api/foods/{milk2}/open', { daysLeft: 1 });
await step('move to the same place', 'POST', '/api/foods/{yog}/move', { storage: 'FRIDGE' });
await step('move', 'POST', '/api/foods/{yog}/move', { storage: 'FREEZER' });
await step('move with days', 'POST', '/api/foods/{yog}/move', { storage: 'PANTRY', daysLeft: 40 });
await step('use today', 'POST', '/api/foods/{yog}/use-today');
await step('use today again', 'POST', '/api/foods/{yog}/use-today');
await step('bulk', 'POST', '/api/foods/bulk', {
  addedDate: today,
  storage: 'PANTRY',
  items: [
    { name: 'Rice', quantity: 1, unit: 'kg' },
    { name: 'Peas', quantity: 1, unit: 'pack', lifespanDays: 200, storage: 'FREEZER', notes: 'x' },
    { name: 'Bananas', quantity: 6, unit: 'pcs', price: 1.2 },
  ],
});
await step('bulk with a bad row', 'POST', '/api/foods/bulk', {
  addedDate: today,
  items: [
    { name: 'Rice', quantity: 1, unit: 'kg' },
    { name: 'Peas', quantity: 1, unit: 'cups' },
  ],
});
await step('bulk past the model limit', 'POST', '/api/foods/bulk', {
  addedDate: today,
  items: [
    { name: 'Rice', quantity: 1, unit: 'kg' },
    { name: emoji(31), quantity: 1, unit: 'kg' },
  ],
});
for (let i = 0; i < 3; i++)
  await step(`spinach ${i}`, 'POST', '/api/foods', {
    name: i ? 'spinach' : 'Spinach',
    quantity: 1,
    unit: 'bunch',
    lifespanDays: 3 + i,
  });
for (let i = 0; i < 2; i++)
  await step(`eclair ${i}`, 'POST', '/api/foods', {
    name: 'Éclair',
    quantity: 1,
    unit: 'pcs',
    lifespanDays: 2 + i * 3,
  });
for (let i = 0; i < 2; i++)
  await step(`apple ${i}`, 'POST', '/api/foods', { name: 'apple', quantity: 1, unit: 'pcs', lifespanDays: 10 });
await step('estimated from what was learned', 'POST', '/api/foods', { name: 'Spinach', quantity: 1, unit: 'bunch' });
await step('suggestions', 'GET', '/api/suggestions/lifespans');
await step(
  'favourite',
  'POST',
  '/api/favourites',
  { name: ' Eggs ', quantity: 6, unit: 'pcs', lifespanDays: 14 },
  'fav',
);
await step('favourite again', 'POST', '/api/favourites', { name: 'EGGS', quantity: 6, unit: 'pcs', lifespanDays: 14 });
await step('favourite past the model limit', 'POST', '/api/favourites', {
  name: emoji(31),
  quantity: 6,
  unit: 'pcs',
  lifespanDays: 14,
});
await step('second favourite', 'POST', '/api/favourites', {
  name: 'apples',
  quantity: 6,
  unit: 'pcs',
  lifespanDays: 14,
  storage: 'PANTRY',
});
await step('favourites', 'GET', '/api/favourites');
await step('re-add', 'POST', '/api/favourites/{fav}/add');
await step('delete favourite', 'DELETE', '/api/favourites/{fav}');
await step('delete it again', 'DELETE', '/api/favourites/{fav}');
await step('usage', 'GET', '/api/usage');
await step('usage page', 'GET', '/api/usage?limit=2&offset=1');
await step('usage limit not a number', 'GET', '/api/usage?limit=abc');
await step('usage limit 0', 'GET', '/api/usage?limit=0');
await step('usage limit twice', 'GET', '/api/usage?limit=5&limit=6');
await step('usage hex and empty', 'GET', '/api/usage?limit=0x3&offset=');
await step('usage fraction', 'GET', '/api/usage?limit=2.5');
await step('final list', 'GET', '/api/foods');

// The documents each server left behind, in the order they were written.
const clients = await Promise.all([mongoA, mongoB].map((mongo) => MongoClient.connect(mongo.getUri())));
const stored = [normaliser(), normaliser()];
for (const name of ['users', 'fooditems', 'usagerecords', 'favourites', 'notifications']) {
  const [a, b] = await Promise.all(
    clients.map((client, i) =>
      client
        .db('fridgestock')
        .collection(name)
        .find()
        .sort({ _id: 1 })
        .toArray()
        // Reminders are upserts, and MongoDB (not the server) decides the order of their filter's fields.
        .then((docs) =>
          docs.map((doc) => stored[i](name === 'notifications' ? Object.fromEntries(Object.entries(doc).sort()) : doc)),
        ),
    ),
  );
  checked += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    differences += 1;
    console.log(`DIFF documents in ${name} (${a.length} from node, ${b.length} from python)`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const [x, y] = [JSON.stringify(a[i]), JSON.stringify(b[i])];
      if (x !== y) console.log(`  [${i}] node:   ${x}\n  [${i}] python: ${y}`);
    }
  }
}
await Promise.all(clients.map((client) => client.close()));
await stop();
console.log(`${checked - differences} of ${checked} identical`);
process.exit(differences ? 1 : 0);
