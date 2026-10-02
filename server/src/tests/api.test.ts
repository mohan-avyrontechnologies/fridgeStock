import { ERROR_CODES } from '@cook-first/shared';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/errorHandler.js';
import { NotificationModel } from '../models/Notification.js';
import * as foodService from '../services/foodService.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** The API contract: routes, response shapes and error format. */

let s: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errors', () => {
  it('every error has a known code and a message, and never a stack trace', async () => {
    const responses = [
      await api().get('/api/foods'), // 401
      await s.auth(api().get('/api/foods/000000000000000000000000')), // 404
      await s.auth(api().post('/api/foods').send({})), // 400
      await api().post('/api/auth/register').send({ name: 'Dup', email: s.user.email, password: 'longenough' }), // 409
      await api().post('/api/auth/login').send({ email: s.user.email, password: 'wrong-password' }), // 401
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 404, 400, 409, 401]);
    for (const res of responses) {
      expect(ERROR_CODES).toContain(res.body.error.code);
      expect(res.body.error.message).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/stack|\bat .+\.(ts|js):\d+/);
    }
  });

  it('an unexpected failure is 500 INTERNAL with a generic message and no stack trace', async () => {
    vi.spyOn(foodService, 'listFoods').mockRejectedValue(new Error('boom at secret.ts:12'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await s.auth(api().get('/api/foods')).expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });

  it('turns a database validation error into 400 VALIDATION_ERROR rather than 500', async () => {
    const { FoodItemModel } = await import('../models/FoodItem.js');
    const app = express();
    app.get('/', async () => {
      await new FoodItemModel({ unit: 'cups' }).validate();
    });
    app.use(errorHandler);
    const res = await request(app).get('/').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field).toEqual(expect.any(String));
  });

  it('login failure is 401 UNAUTHENTICATED "Email or password is incorrect."', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: s.user.email, password: 'wrong-password' })
      .expect(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect.' } });
  });

  it.each([
    [{ name: 'A', email: 'not-an-email', password: 'longenough' }, 'email', 'Enter a valid email address.'],
    [{ name: 'A', email: 'a@example.com', password: 'short' }, 'password', 'Password must be at least 8 characters.'],
  ])('register rejects %o with the exact message', async (body, field, message) => {
    const res = await api().post('/api/auth/register').send(body).expect(400);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', field, message });
  });
});

describe('responses', () => {
  it('users have id, name, email, time zone, currency, preferences and reminder delivery only', async () => {
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(Object.keys(me.body.user).sort()).toEqual([
      'currency',
      'email',
      'id',
      'name',
      'notificationPreferences',
      'reminderDelivery',
      'timeZone',
    ]);
  });

  it('food items have their stored fields plus remaining days and urgency', async () => {
    const res = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ notes: 'Top shelf' })),
      )
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Milk',
      quantity: 1,
      unit: 'l',
      addedDate: '2026-09-29',
      lifespanDays: 4,
      expiryDate: '2026-10-03',
      notes: 'Top shelf',
      status: 'ACTIVE',
      closedAt: null,
      remainingDays: 4,
      urgency: 'NOT_URGENT',
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('GET /foods returns active items in priority order with the urgency summary', async () => {
    await s.auth(
      api()
        .post('/api/foods')
        .send(food({ name: 'Later', lifespanDays: 9 })),
    );
    await s.auth(
      api()
        .post('/api/foods')
        .send(food({ name: 'Sooner', lifespanDays: 1 })),
    );
    const res = await s.auth(api().get('/api/foods')).expect(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Sooner', 'Later']);
    expect(res.body.summary).toEqual({ NOT_URGENT: 1, APPROACHING_EXPIRY: 1, DUE: 0, OVERDUE: 0, total: 2 });
  });
});

describe('routes', () => {
  it('/foods/cook-first is matched before /foods/:id', async () => {
    const res = await s.auth(api().get('/api/foods/cook-first')).expect(200);
    expect(res.body).toHaveProperty('items');
  });

  it('POST /foods returns 201 and schedules the reminders', async () => {
    const res = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ lifespanDays: 10 })),
      )
      .expect(201);
    expect(await NotificationModel.countDocuments({ foodId: res.body.id, status: 'PENDING' })).toBe(3);
  });

  it('PUT /foods/:id reschedules reminders only when the added date or lifespan changes', async () => {
    const { body } = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ lifespanDays: 10 })),
      )
      .expect(201);
    const ids = async () =>
      (await NotificationModel.find({ foodId: body.id }).sort({ _id: 1 })).map((n) => String(n._id));
    const before = await ids();

    await s.auth(api().put(`/api/foods/${body.id}`).send({ name: 'Oat milk', notes: 'x' })).expect(200);
    expect(await ids()).toEqual(before);

    await s.auth(api().put(`/api/foods/${body.id}`).send({ lifespanDays: 6 })).expect(200);
    const after = await NotificationModel.find({ foodId: body.id, status: 'PENDING' });
    expect(after.map((n) => n.expiryDate)).toEqual(['2026-10-05', '2026-10-05', '2026-10-05']);
  });

  it('closing an item deletes its pending reminders', async () => {
    const { body } = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ lifespanDays: 10 })),
      )
      .expect(201);
    await s.auth(api().post(`/api/foods/${body.id}/waste`).send({})).expect(200);
    expect(await NotificationModel.countDocuments({ foodId: body.id, status: 'PENDING' })).toBe(0);
  });

  it('removed routes are gone', async () => {
    await s.auth(api().get('/api/usage-records')).expect(404);
    await s.auth(api().put('/api/notifications/read-all')).expect(404);
  });
});
