import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { UserModel } from '../models/User.js';
import { api, registerUser } from './helpers.js';

/** The first-run guide is shown once: new accounts start with it not done, and older accounts count as done. */

describe('first-run guide flag', () => {
  it('a new account has not seen it yet', async () => {
    const s = await registerUser();
    expect(s.user.firstRunDone).toBe(false);
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.firstRunDone).toBe(false);
  });

  it('can be marked done, and stays done', async () => {
    const s = await registerUser();
    const res = await s.auth(api().put('/api/auth/me').send({ firstRunDone: true })).expect(200);
    expect(res.body.user.firstRunDone).toBe(true);
    const login = await api().post('/api/auth/login').send({ email: s.user.email, password: s.password }).expect(200);
    expect(login.body.user.firstRunDone).toBe(true);
  });

  it('an account made before the guide existed counts as done', async () => {
    const s = await registerUser();
    await UserModel.collection.updateOne({ _id: new Types.ObjectId(s.user.id) }, { $unset: { firstRunDone: '' } });
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.firstRunDone).toBe(true);
  });

  it('only a true or false is accepted, and it needs a login', async () => {
    const s = await registerUser();
    await s.auth(api().put('/api/auth/me').send({ firstRunDone: 'yes' })).expect(400);
    await api().put('/api/auth/me').send({ firstRunDone: true }).expect(401);
  });

  it('one person finishing it does not change another’s', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await a.auth(api().put('/api/auth/me').send({ firstRunDone: true })).expect(200);
    const me = await b.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.firstRunDone).toBe(false);
  });
});
