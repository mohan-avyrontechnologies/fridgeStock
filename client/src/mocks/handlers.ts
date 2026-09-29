/** MSW handlers: the fake API used by the frontend tests. */
import { http, HttpResponse } from 'msw';
import type { ActiveFoodItem, FoodList } from '@cook-first/shared';
import { API_URL } from '../api/client';

export function item(overrides: Partial<ActiveFoodItem>): ActiveFoodItem {
  return {
    id: 'id',
    name: 'Milk',
    quantity: 1,
    unit: 'l',
    addedDate: '2026-09-29',
    lifespanDays: 4,
    expectedExpiryDate: '2026-10-03',
    status: 'ACTIVE',
    remainingDays: 4,
    urgency: 'NOT_URGENT',
    closedAt: null,
    createdAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z',
    ...overrides,
  };
}

export const sampleItems: ActiveFoodItem[] = [
  item({ id: 'a', name: 'Bread', expectedExpiryDate: '2026-09-28', remainingDays: -1, urgency: 'PAST_EXPECTED_EXPIRY' }),
  item({ id: 'b', name: 'Yoghurt', expectedExpiryDate: '2026-09-29', remainingDays: 0, urgency: 'DUE_TODAY' }),
  item({ id: 'c', name: 'Spinach', expectedExpiryDate: '2026-10-01', remainingDays: 2, urgency: 'USE_SOON' }),
  item({ id: 'd', name: 'Eggs', quantity: 12, unit: 'pcs', expectedExpiryDate: '2026-10-07', remainingDays: 8 }),
];

export const sampleList: FoodList = {
  today: '2026-09-29',
  summary: { NOT_URGENT: 1, USE_SOON: 1, DUE_TODAY: 1, PAST_EXPECTED_EXPIRY: 1 },
  items: sampleItems,
};

export const handlers = [
  http.get(`${API_URL}/foods`, () => HttpResponse.json(sampleList)),
  http.get(`${API_URL}/foods/cook-first`, () =>
    HttpResponse.json({ today: sampleList.today, items: sampleItems.filter((i) => i.urgency !== 'NOT_URGENT') }),
  ),
  http.get(`${API_URL}/notifications/unread-count`, () => HttpResponse.json({ unread: 2 })),
];

