import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Layout rules for client/src, checked against the source itself. */
const SRC = path.resolve('src');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

describe('client/src layout', () => {
  it('has api, stores, pages, components and mocks folders plus copy.ts', () => {
    for (const dir of ['api', 'stores', 'pages', 'components', 'mocks']) {
      expect(existsSync(path.join(SRC, dir)), dir).toBe(true);
    }
    expect(existsSync(path.join(SRC, 'copy.ts'))).toBe(true);
  });

  it('has the auth, food and notification stores', () => {
    for (const store of ['authStore.ts', 'foodStore.ts', 'notificationStore.ts']) {
      expect(existsSync(path.join(SRC, 'stores', store)), store).toBe(true);
    }
  });

  it('has one file per screen, each exporting exactly one page component', () => {
    const pages = readdirSync(path.join(SRC, 'pages')).sort();
    expect(pages).toEqual([
      'AddFoodPage.tsx',
      'BulkAddPage.tsx',
      'CookFirstPage.tsx',
      'DashboardPage.tsx',
      'FoodDetailPage.tsx',
      'HistoryPage.tsx',
      'LoginPage.tsx',
      'NotificationsPage.tsx',
      'PlanPage.tsx',
      'RegisterPage.tsx',
      'SettingsPage.tsx',
      'ShoppingPage.tsx',
    ]);
    for (const page of pages) {
      const exported = [...read(`pages/${page}`).matchAll(/export function (\w+Page)\b/g)].map((m) => m[1]);
      expect(exported, page).toEqual([page.replace('.tsx', '')]);
    }
  });

  it('keeps the food card and urgency badge in components', () => {
    expect(read('components/FoodCard.tsx')).toMatch(/export function FoodCard\b/);
    expect(read('components/Urgency.tsx')).toMatch(/export function UrgencyBadge\b/);
  });

  it('keeps MSW handlers in mocks/', () => {
    expect(read('mocks/handlers.ts')).toMatch(/from 'msw'/);
    expect(read('mocks/server.ts')).toMatch(/setupServer/);
  });
});

describe('api', () => {
  it('defaults to http://localhost:4000/api and can be overridden by VITE_API_URL', () => {
    expect(read('api/client.ts')).toMatch(/import\.meta\.env\.VITE_API_URL \?\? 'http:\/\/localhost:4000\/api'/);
  });

  it('has one function per endpoint', () => {
    const client = read('api/client.ts');
    const endpoints = [...client.matchAll(/^\s*\/\/ (GET|POST|PUT|DELETE) (\S+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(endpoints).toHaveLength(44);
    expect(new Set(endpoints).size).toBe(endpoints.length);
  });
});

describe('auth token', () => {
  it("is persisted in localStorage through Zustand's persist middleware", () => {
    const store = read('stores/authStore.ts');
    expect(store).toMatch(/from 'zustand\/middleware'/);
    expect(store).toMatch(/persist\(/);
  });
});

describe('shared package', () => {
  it('types, enums, schemas and dates come from @cook-first/shared, not local copies', () => {
    expect(existsSync(path.join(SRC, 'api/types.ts'))).toBe(false);
    expect(existsSync(path.join(SRC, 'lib/dates.ts'))).toBe(false);
    expect(read('components/FoodForm.tsx')).toMatch(/createFoodSchema/);
    expect(read('pages/RegisterPage.tsx')).toMatch(/registerSchema/);
    expect(read('pages/LoginPage.tsx')).toMatch(/loginSchema/);
  });
});
