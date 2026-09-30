import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { UserModel } from '../models/User.js';
import { AUTH_RATE_LIMIT } from '../routes/index.js';
import { signActionToken } from '../services/token.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Project rules that must never be broken, each checked directly. */

describe('every data query is scoped to the signed-in user', () => {
  type Op = { collection: string; method: string; args: unknown[] };
  const SCOPED = new Set(['fooditems', 'usagerecords', 'notifications', 'favourites', 'pushsubscriptions']);
  const IGNORED = new Set(['createIndex', 'createIndexes', 'listIndexes', 'dropIndex']);

  afterEach(() => {
    mongoose.set('debug', false);
  });

  /** The filter (or inserted document / $match) that decides whose data is touched. */
  function scopeOf(op: Op): unknown {
    const [first, second] = op.args;
    if (op.method === 'aggregate') return (first as Record<string, unknown>[])[0]?.$match;
    if (op.method === 'distinct') return second;
    if (op.method === 'insertMany') return (first as unknown[])[0];
    return first;
  }

  it('food items, usage records and notifications: every read and write carries userId', async () => {
    setToday('2026-09-29');
    const s = await registerUser();
    const ops: Op[] = [];
    mongoose.set('debug', (collection: string, method: string, ...args: unknown[]) => {
      ops.push({ collection, method, args });
    });

    // A full journey that touches every collection and code path.
    const a = (
      await s.auth(
        api()
          .post('/api/foods')
          .send(food({ lifespanDays: 2, quantity: 2 })),
      )
    ).body;
    const b = (
      await s.auth(
        api()
          .post('/api/foods')
          .send(food({ lifespanDays: 9 })),
      )
    ).body;
    await s.auth(api().get('/api/foods'));
    await s.auth(api().get('/api/foods/cook-first'));
    await s.auth(api().get(`/api/foods/${a.id}`));
    await s.auth(api().put(`/api/foods/${a.id}`).send({ lifespanDays: 1 }));
    await s.auth(api().post(`/api/foods/${a.id}/use`).send({ quantity: 1 }));
    await s.auth(api().get('/api/notifications'));
    await s.auth(api().get('/api/notifications/unread-count'));
    await s.auth(api().post('/api/notifications/read-all'));
    await s.auth(api().put('/api/notifications/preferences').send({ due: false }));
    await s.auth(api().post(`/api/foods/${a.id}/waste`).send({}));
    await s.auth(api().delete(`/api/foods/${b.id}`));
    await s.auth(api().get('/api/usage'));
    await s.auth(api().post(`/api/foods/${b.id}/undo`));
    await s.auth(
      api()
        .post('/api/foods/bulk')
        .send({ addedDate: '2026-09-29', items: [{ name: 'Peas', quantity: 1, unit: 'pack', lifespanDays: 9 }] }),
    );
    const fav = (
      await s.auth(api().post('/api/favourites').send({ name: 'Milk', quantity: 1, unit: 'l', lifespanDays: 5 }))
    ).body;
    await s.auth(api().get('/api/favourites'));
    await s.auth(api().post(`/api/favourites/${fav.id}/add`));
    await s.auth(api().delete(`/api/favourites/${fav.id}`));
    const c = (
      await s.auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Milk', lifespanDays: 9 })),
      )
    ).body;
    await s.auth(api().post(`/api/foods/${c.id}/open`).send({}));
    await s.auth(api().delete(`/api/foods/${c.id}/open`));
    await s.auth(api().post(`/api/foods/${c.id}/move`).send({ storage: 'FREEZER' }));
    await s.auth(api().get('/api/suggestions/lifespans'));
    const endpoint = 'https://push.example.com/send/rules';
    await s.auth(
      api()
        .post('/api/push/subscriptions')
        .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    );
    await s.auth(api().get('/api/push/config'));
    await s.auth(api().put('/api/notifications/delivery').send({ mode: 'EACH_ITEM', hour: 9 }));
    await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(s.user.id, c.id), action: 'SNOOZE' });
    await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(s.user.id, c.id), action: 'USED' });
    await s.auth(api().delete('/api/push/subscriptions').send({ endpoint }));
    mongoose.set('debug', false);

    const dataOps = ops.filter((op) => SCOPED.has(op.collection) && !IGNORED.has(op.method));
    expect(new Set(dataOps.map((op) => op.collection))).toEqual(SCOPED);

    const unscoped = dataOps.filter((op) => {
      const scope = JSON.stringify(scopeOf(op) ?? {});
      return !scope.includes(s.user.id);
    });
    expect(unscoped.map((op) => `${op.collection}.${op.method} ${JSON.stringify(op.args[0])}`)).toEqual([]);
  });

  it('ignores a userId passed in the query string', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await alice
      .auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Alice milk' })),
      )
      .expect(201);
    const res = await bob.auth(api().get(`/api/foods?userId=${alice.user.id}`)).expect(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('priority engine is pure', () => {
  it('imports nothing that touches a database, HTTP or the clock', () => {
    const source = readFileSync(path.resolve('src/services/priorityEngine.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).not.toMatch(/mongoose|mongodb|express|\/models\/|\/controllers\/|\/routes\/|clock/);
    }
  });
});

describe('passwords', () => {
  it('are hashed with bcrypt at cost 12', async () => {
    const s = await registerUser();
    const user = await UserModel.findById(s.user.id);
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('are never returned by register, login or /auth/me', async () => {
    const s = await registerUser();
    const login = await api().post('/api/auth/login').send({ email: s.user.email, password: s.password });
    const me = await s.auth(api().get('/api/auth/me'));
    for (const body of [s.user, login.body, me.body]) {
      const json = JSON.stringify(body);
      expect(json).not.toMatch(/passwordHash|"password"/);
      expect(json).not.toContain(s.password);
    }
  });

  it('are never logged: the request log records only method, route, status and time', () => {
    const app = readFileSync(path.resolve('src/app.ts'), 'utf8');
    const logged = app.slice(app.indexOf('JSON.stringify({'), app.indexOf('}),', app.indexOf('JSON.stringify({')));
    expect(logged).not.toMatch(/body|password|headers|authorization/i);
  });
});

describe('secrets', () => {
  it('.env.example is committed and .env is git-ignored', () => {
    expect(existsSync(path.resolve('.env.example'))).toBe(true);
    const ignored = readFileSync(path.resolve('../.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignored).toContain('.env');
  });

  it('JWT secret and database URL come only from environment variables', () => {
    const env = readFileSync(path.resolve('src/config/env.ts'), 'utf8');
    expect(env).toContain('process.env.JWT_SECRET');
    expect(env).toContain('process.env.MONGO_URI');
    expect(env).toMatch(/JWT_SECRET must be set in production/);
  });
});

describe('HTTP hardening', () => {
  it('sends helmet security headers', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for the client origin', async () => {
    const allowed = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await api().get('/api/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits authentication to 20 requests per 15 minutes per IP', async () => {
    expect(AUTH_RATE_LIMIT).toEqual({ windowMs: 15 * 60 * 1000, limit: 20 });
    process.env.AUTH_RATE_LIMIT = 'on';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const res = await api()
          .post('/api/auth/login')
          .set('X-Forwarded-For', '203.0.113.7')
          .send({ email: 'nobody@example.com', password: 'wrong-password' });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
      expect(statuses[20]).toBe(429);

      // A different IP address has its own allowance.
      const other = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.9')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });
      expect(other.status).toBe(401);
    } finally {
      process.env.AUTH_RATE_LIMIT = 'off';
    }
  });
});
