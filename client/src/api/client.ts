import type {
  AppNotification,
  FoodInput,
  FoodItem,
  FoodList,
  NotificationPreferences,
  Page,
  UsageAction,
  UsageRecord,
  User,
} from './types';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

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
    res = await fetch(`${BASE}${path}`, {
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

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const api = {
  register: (body: { name: string; email: string; password: string }) =>
    request<{ token: string; user: User }>('POST', '/auth/register', { ...body, timeZone: timeZone() }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { ...body, timeZone: timeZone() }),
  me: () => request<{ user: User }>('GET', '/auth/me'),
  updateMe: (body: { name?: string; timeZone?: string }) => request<{ user: User }>('PUT', '/auth/me', body),

  listFoods: () => request<FoodList>('GET', '/foods'),
  cookFirst: () => request<Omit<FoodList, 'summary'>>('GET', '/foods/cook-first'),
  getFood: (id: string) => request<FoodItem>('GET', `/foods/${id}`),
  createFood: (body: FoodInput) => request<FoodItem>('POST', '/foods', body),
  updateFood: (id: string, body: Partial<FoodInput>) => request<FoodItem>('PUT', `/foods/${id}`, body),
  removeFood: (id: string) => request<void>('DELETE', `/foods/${id}`),
  useFood: (id: string, action: 'USED' | 'PARTIALLY_USED', quantityUsed?: number) =>
    request<{ food: FoodItem; usageRecord: UsageRecord }>('POST', `/foods/${id}/use`, { action, quantityUsed }),
  wasteFood: (id: string, quantityUsed?: number) =>
    request<{ food: FoodItem; usageRecord: UsageRecord }>('POST', `/foods/${id}/waste`, { quantityUsed }),

  usageRecords: (offset = 0, limit = 20) =>
    request<Page<UsageRecord> & { counts: Record<UsageAction, number> }>(
      'GET',
      `/usage-records?offset=${offset}&limit=${limit}`,
    ),

  notifications: (offset = 0, limit = 30) =>
    request<Page<AppNotification> & { unread: number }>('GET', `/notifications?offset=${offset}&limit=${limit}`),
  unreadCount: () => request<{ unread: number }>('GET', '/notifications/unread-count'),
  markRead: (id: string) => request<AppNotification>('PUT', `/notifications/${id}/read`),
  markAllRead: () => request<void>('PUT', '/notifications/read-all'),
  preferences: () => request<NotificationPreferences>('GET', '/notifications/preferences'),
  updatePreferences: (body: Partial<NotificationPreferences>) =>
    request<NotificationPreferences>('PUT', '/notifications/preferences', body),
};
