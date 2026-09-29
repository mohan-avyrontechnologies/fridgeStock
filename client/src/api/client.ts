import type {
  AuthResponse,
  BulkCreateInput,
  BulkCreateResult,
  Favourite,
  FavouriteInput,
  CookFirstList,
  FoodInput,
  FoodItem,
  FoodList,
  FoodUpdateInput,
  LearnedLifespan,
  MoveFoodInput,
  OpenFoodInput,
  NotificationFeed,
  NotificationPreferences,
  PreferencesInput,
  UpdateAccountInput,
  UsageHistory,
  UsageResult,
  User,
} from '@cook-first/shared';

/** Base URL of the API. Set VITE_API_URL for other environments. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

let getToken: () => string | null = () => null;
let onUnauthenticated: () => void = () => {};

/** Wired up by the auth store so this module doesn't import it (no cycle). */
export function configureApi(options: { getToken: () => string | null; onUnauthenticated: () => void }) {
  getToken = options.getToken;
  onUnauthenticated = options.onUnauthenticated;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error ?? {};
    if (res.status === 401 && token) onUnauthenticated();
    throw new ApiError(res.status, error.code ?? 'UNKNOWN', error.message ?? 'Something went wrong.', error.field);
  }
  return data as T;
}

/** Captured silently from the browser and sent with sign-up and sign-in. */
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One function per API endpoint. */
export const api = {
  // POST /auth/register
  register: (body: { name: string; email: string; password: string }) =>
    request<AuthResponse>('POST', '/auth/register', { ...body, timeZone: browserTimeZone() }),
  // POST /auth/login
  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('POST', '/auth/login', { ...body, timeZone: browserTimeZone() }),
  // GET /auth/me
  me: () => request<{ user: User }>('GET', '/auth/me'),
  // PUT /auth/me
  updateMe: (body: UpdateAccountInput) => request<{ user: User }>('PUT', '/auth/me', body),

  // GET /foods
  listFoods: () => request<FoodList>('GET', '/foods'),
  // GET /foods/cook-first
  cookFirst: () => request<CookFirstList>('GET', '/foods/cook-first'),
  // POST /foods/bulk
  bulkCreate: (body: BulkCreateInput) => request<BulkCreateResult>('POST', '/foods/bulk', body),
  // POST /foods/:id/undo
  undo: (id: string) => request<FoodItem>('POST', `/foods/${id}/undo`),
  // POST /foods/:id/open
  openFood: (id: string, body: OpenFoodInput) => request<FoodItem>('POST', `/foods/${id}/open`, body),
  // DELETE /foods/:id/open
  undoOpen: (id: string) => request<FoodItem>('DELETE', `/foods/${id}/open`),
  // POST /foods/:id/move
  moveFood: (id: string, body: MoveFoodInput) => request<FoodItem>('POST', `/foods/${id}/move`, body),
  // GET /suggestions/lifespans
  learnedLifespans: () => request<{ items: LearnedLifespan[] }>('GET', '/suggestions/lifespans'),
  // GET /foods/:id
  getFood: (id: string) => request<FoodItem>('GET', `/foods/${id}`),
  // POST /foods
  createFood: (body: FoodInput) => request<FoodItem>('POST', '/foods', body),
  // PUT /foods/:id
  updateFood: (id: string, body: FoodUpdateInput) => request<FoodItem>('PUT', `/foods/${id}`, body),
  // DELETE /foods/:id
  removeFood: (id: string) => request<void>('DELETE', `/foods/${id}`),
  // POST /foods/:id/use
  // Without a quantity the whole item is used; a smaller quantity is a partial use.
  useFood: (id: string, quantity?: number) =>
    request<UsageResult>('POST', `/foods/${id}/use`, quantity === undefined ? {} : { quantity }),
  // POST /foods/:id/waste
  wasteFood: (id: string) => request<UsageResult>('POST', `/foods/${id}/waste`, {}),

  // GET /favourites
  favourites: () => request<{ items: Favourite[] }>('GET', '/favourites'),
  // POST /favourites
  createFavourite: (body: FavouriteInput) => request<Favourite>('POST', '/favourites', body),
  // DELETE /favourites/:id
  removeFavourite: (id: string) => request<void>('DELETE', `/favourites/${id}`),
  // POST /favourites/:id/add
  addFavourite: (id: string) => request<FoodItem>('POST', `/favourites/${id}/add`),

  // GET /usage
  usage: (offset = 0, limit = 20) => request<UsageHistory>('GET', `/usage?offset=${offset}&limit=${limit}`),

  // GET /notifications
  notifications: (offset = 0, limit = 50) =>
    request<NotificationFeed>('GET', `/notifications?offset=${offset}&limit=${limit}`),
  // GET /notifications/unread-count
  unreadCount: () => request<{ unread: number }>('GET', '/notifications/unread-count'),
  // POST /notifications/read-all
  markAllRead: () => request<void>('POST', '/notifications/read-all'),
  // GET /notifications/preferences
  preferences: () => request<NotificationPreferences>('GET', '/notifications/preferences'),
  // PUT /notifications/preferences
  updatePreferences: (body: PreferencesInput) =>
    request<NotificationPreferences>('PUT', '/notifications/preferences', body),
};
