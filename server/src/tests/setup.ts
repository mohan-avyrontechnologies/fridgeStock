import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { clock } from '../services/clock.js';

process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = 'off';

beforeAll(async () => {
  await mongoose.connect(`${process.env.TEST_MONGO_URI}fridgestock-test`);
  await mongoose.connection.syncIndexes();
});

beforeEach(async () => {
  clock.set(null);
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
});
