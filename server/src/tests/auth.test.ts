import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { UserModel } from '../models/User.js';
import { api, registerUser } from './helpers.js';

describe('registration', () => {
  it('creates an account and returns a token and user', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'longenough', timeZone: 'Asia/Kolkata' })
      .expect(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      name: 'Asha',
      email: 'asha@example.com',
      timeZone: 'Asia/Kolkata',
      notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('stores a bcrypt hash, never the plaintext password', async () => {
    await registerUser({ email: 'hash@example.com', password: 'plaintext-password' });
    const user = await UserModel.findOne({ email: 'hash@example.com' });
    expect(user!.passwordHash).not.toContain('plaintext-password');
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('rejects a duplicate email with 409', async () => {
    await registerUser({ email: 'dup@example.com' });
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Again', email: 'DUP@example.com', password: 'longenough' })
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', field: 'email' });
    expect(await UserModel.countDocuments({ email: 'dup@example.com' })).toBe(1);
  });

  it('limits names to 50 characters and stores email in lowercase', async () => {
    const long = await api()
      .post('/api/auth/register')
      .send({ name: 'n'.repeat(51), email: 'long@example.com', password: 'longenough' })
      .expect(400);
    expect(long.body.error).toMatchObject({ field: 'name', message: 'Name must be at most 50 characters.' });
    const ok = await api()
      .post('/api/auth/register')
      .send({ name: 'n'.repeat(50), email: 'MiXeD@Example.COM', password: 'longenough' })
      .expect(201);
    expect(ok.body.user.email).toBe('mixed@example.com');
  });

  it('defaults the time zone to UTC and turns on all three reminder types', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Default', email: 'defaults@example.com', password: 'longenough' })
      .expect(201);
    expect(res.body.user.timeZone).toBe('UTC');
    expect(res.body.user.notificationPreferences).toEqual({ approachingExpiry: true, due: true, overdue: true });
  });

  it('rejects short passwords and bad emails', async () => {
    const short = await api()
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'short' })
      .expect(400);
    expect(short.body.error.field).toBe('password');
    const email = await api()
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'longenough' })
      .expect(400);
    expect(email.body.error.field).toBe('email');
  });

  it('falls back to UTC for an unknown time zone', async () => {
    const { user } = await registerUser({ timeZone: 'Mars/Olympus' });
    expect(user.timeZone).toBe('UTC');
  });
});

describe('login', () => {
  it('logs in with valid credentials', async () => {
    const { user, password } = await registerUser();
    const res = await api().post('/api/auth/login').send({ email: user.email, password }).expect(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(user.id);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const { user } = await registerUser();
    const wrong = await api().post('/api/auth/login').send({ email: user.email, password: 'nope-nope' });
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('updates the stored time zone to where the user signs in', async () => {
    const { user, password } = await registerUser({ timeZone: 'UTC' });
    const res = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password, timeZone: 'Europe/London' })
      .expect(200);
    expect(res.body.user.timeZone).toBe('Europe/London');
  });
});

describe('protected endpoints', () => {
  it('reject missing, malformed, tampered and expired tokens', async () => {
    const { user } = await registerUser();
    const expired = jwt.sign({}, env.jwtSecret, { subject: user.id, expiresIn: -10 });
    const forged = jwt.sign({}, 'some-other-secret', { subject: user.id });

    for (const header of [undefined, 'Bearer', 'Bearer garbage', `Bearer ${expired}`, `Bearer ${forged}`, 'Basic abc']) {
      const req = api().get('/api/foods');
      if (header) req.set('Authorization', header);
      const res = await req.expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects a valid token for a deleted user', async () => {
    const { user, auth } = await registerUser();
    await UserModel.deleteOne({ _id: user.id });
    await auth(api().get('/api/foods')).expect(401);
  });

  it('returns the current user from /auth/me', async () => {
    const { user, auth } = await registerUser();
    const res = await auth(api().get('/api/auth/me')).expect(200);
    expect(res.body.user.id).toBe(user.id);
  });
});
