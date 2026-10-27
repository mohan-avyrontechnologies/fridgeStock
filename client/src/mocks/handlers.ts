/** MSW handlers: the fake API used by the frontend tests. */
import { http, HttpResponse } from 'msw';
import type { ActiveFoodItem, FoodList } from '@fridgestock/shared';
import { API_URL } from '../api/client';

export function item(overrides: Partial<ActiveFoodItem>): ActiveFoodItem {
  return {
    id: 'id',
    name: 'Milk',
    quantity: 1,
    unit: 'l',
    addedDate: '2026-09-29',
    lifespanDays: 4,
    expiryDate: '2026-10-03',
    expirySource: 'CATALOG',
    estimateExplanation: 'Catalog: milk lasts about 4 days in the fridge.',
    printedDate: null,
    printedDateType: null,
    notes: null,
    storage: 'FRIDGE',
    openedDate: null,
    leftover: false,
    price: null,
    photoAt: null,
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
  item({ id: 'a', name: 'Bread', expiryDate: '2026-09-28', remainingDays: -1, urgency: 'OVERDUE' }),
  item({ id: 'b', name: 'Yoghurt', expiryDate: '2026-09-29', remainingDays: 0, urgency: 'DUE' }),
  item({ id: 'c', name: 'Spinach', expiryDate: '2026-10-01', remainingDays: 2, urgency: 'APPROACHING_EXPIRY' }),
  item({ id: 'd', name: 'Eggs', quantity: 12, unit: 'pcs', expiryDate: '2026-10-07', remainingDays: 8 }),
];

export const sampleList: FoodList = {
  today: '2026-09-29',
  summary: { NOT_URGENT: 1, APPROACHING_EXPIRY: 1, DUE: 1, OVERDUE: 1, total: 4 },
  items: sampleItems,
};

export const handlers = [
  http.get(`${API_URL}/foods`, () => HttpResponse.json(sampleList)),
  http.get(`${API_URL}/foods/fridgestock`, () =>
    HttpResponse.json({ today: sampleList.today, items: sampleItems.filter((i) => i.urgency !== 'NOT_URGENT') }),
  ),
  http.get(`${API_URL}/notifications/unread-count`, () => HttpResponse.json({ unread: 2 })),
  http.get(`${API_URL}/favourites`, () => HttpResponse.json({ items: [] })),
  http.get(`${API_URL}/suggestions/lifespans`, () => HttpResponse.json({ items: [] })),
  http.get(`${API_URL}/notifications/delivery`, () => HttpResponse.json({ mode: 'DIGEST', hour: 8 })),
  http.get(`${API_URL}/notifications/alerts`, () =>
    HttpResponse.json({ sound: true, vibration: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } }),
  ),
  http.get(`${API_URL}/notifications/meals`, () =>
    HttpResponse.json({
      breakfast: { enabled: false, time: '07:30' },
      lunch: { enabled: false, time: '12:30' },
      dinner: { enabled: false, time: '19:30' },
    }),
  ),
  http.get(`${API_URL}/meal-plan`, () => HttpResponse.json({ today: '2026-09-29', days: [] })),
  http.get(`${API_URL}/push/config`, () => HttpResponse.json({ publicKey: null })),
  http.get(`${API_URL}/ai/status`, () =>
    HttpResponse.json({ enabled: false, photoCheck: false, dailyLimit: 20, usedToday: 0 }),
  ),
];
