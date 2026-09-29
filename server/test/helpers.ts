import request from 'supertest';
import { createApp } from '../src/app.js';
import { clock } from '../src/utils/clock.js';

export const app = createApp();
export const api = () => request(app);

let counter = 0;

export async function registerUser(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const body = {
    name: `User ${counter}`,
    email: `user${counter}@example.com`,
    password: 'correct horse battery',
    timeZone: 'UTC',
    ...overrides,
  };
  const res = await api().post('/api/auth/register').send(body).expect(201);
  const token = res.body.token as string;
  return {
    token,
    user: res.body.user,
    password: body.password,
    auth: (r: request.Test) => r.set('Authorization', `Bearer ${token}`),
  };
}

/** Pins "now" to midday UTC on the given calendar date. */
export function setToday(dateKey: string) {
  clock.set(new Date(`${dateKey}T12:00:00Z`));
}

export const food = (overrides: Record<string, unknown> = {}) => ({
  name: 'Milk',
  quantity: 1,
  unit: 'l',
  addedDate: '2026-09-29',
  lifespanDays: 4,
  ...overrides,
});
