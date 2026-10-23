import type {
  PrintedDateInput,
  PrintedDateRead,
  AiStatus,
  AlertSettings,
  AlertSettingsInput,
  AuthResponse,
  BulkCreateInput,
  BulkCreateResult,
  Favourite,
  FavouriteInput,
  CookFirstList,
  DeliveryInput,
  FoodInput,
  FoodItem,
  FoodList,
  FoodUpdateInput,
  LearnedLifespan,
  MealPlan,
  MealPlanDraft,
  MealPlanEntry,
  MealPlanEntryInput,
  MealReminders,
  MealRemindersInput,
  MealReminderView,
  MealType,
  MoveFoodInput,
  OpenFoodInput,
  NotificationFeed,
  NotificationPreferences,
  PreferencesInput,
  PushConfig,
  PushDevice,
  PushSubscriptionInput,
  RecipeIdeas,
  ReminderDelivery,
  ShoppingItem,
  ShoppingItemInput,
  ShoppingUpdateInput,
  UpdateAccountInput,
  AccountExport,
  ActivityLog,
  Household,
  HouseholdInvite,
  JoinHouseholdInput,
  PushActionInput,
  PhotoCheck,
  PhotoCheckInput,
  ProductLookup,
  ReceiptDraft,
  ReceiptInput,
  DeleteAccountInput,
  Insights,
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

/** `explicitToken` is for calls made while signing out, after the stored token is cleared. */
async function request<T>(method: string, path: string, body?: unknown, explicitToken?: string): Promise<T> {
  const headers: Record<string, string> = {};
  // A form (a photo upload) sets its own content type, with the boundary the browser makes.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = explicitToken ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error ?? {};
    if (res.status === 401 && token && !explicitToken) onUnauthenticated();
    throw new ApiError(res.status, error.code ?? 'UNKNOWN', error.message ?? 'Something went wrong.', error.field);
  }
  return data as T;
}

/** Captured silently from the browser and sent with sign-up and sign-in. */
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One function per API endpoint. */
/**
 * A product photo as a Blob. Photos are private, so this sends the login token (an <img> tag can't);
 * `version` is the photo's time stamp, so a replaced photo isn't served from the browser's cache.
 */
async function requestPhoto(id: string, size: 'thumb' | 'full', version: string): Promise<Blob> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/foods/${id}/photo?size=${size}&v=${encodeURIComponent(version)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && token) onUnauthenticated();
  if (!res.ok) throw new ApiError(res.status, 'NOT_FOUND', 'That photo isn’t available.');
  return res.blob();
}

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

  // GET /account/export
  exportData: () => request<AccountExport>('GET', '/account/export'),

  // DELETE /account
  deleteAccount: (body: DeleteAccountInput) => request<void>('DELETE', '/account', body),

  // GET /household
  household: () => request<Household>('GET', '/household'),

  // POST /household/invites
  createInvite: () => request<HouseholdInvite>('POST', '/household/invites'),

  // DELETE /household/invites/:code
  cancelInvite: (code: string) => request<void>('DELETE', `/household/invites/${encodeURIComponent(code)}`),

  // POST /household/join
  joinHousehold: (body: JoinHouseholdInput) => request<Household>('POST', '/household/join', body),

  // POST /household/leave
  leaveHousehold: () => request<Household>('POST', '/household/leave'),

  // GET /household/activity
  householdActivity: (offset = 0, limit = 20) =>
    request<ActivityLog>('GET', `/household/activity?offset=${offset}&limit=${limit}`),

  // GET /products/barcode
  lookupBarcode: (code: string) => request<ProductLookup>('GET', `/products/barcode?code=${encodeURIComponent(code)}`),

  // POST /parse/receipt
  readReceipt: (body: ReceiptInput) => request<ReceiptDraft>('POST', '/parse/receipt', body),

  // POST /parse/date
  readPrintedDate: (body: PrintedDateInput) => request<PrintedDateRead>('POST', '/parse/date', body),

  // POST /parse/photo
  checkPhoto: (body: PhotoCheckInput) => request<PhotoCheck>('POST', '/parse/photo', body),

  // POST /foods/:id/use-today
  useToday: (id: string) => request<FoodItem>('POST', `/foods/${id}/use-today`),

  // POST /foods/:id/photo
  uploadFoodPhoto: (id: string, photo: Blob) => {
    const form = new FormData();
    form.append('photo', photo, 'photo.jpg');
    return request<FoodItem>('POST', `/foods/${id}/photo`, form);
  },

  // GET /foods/:id/photo
  foodPhoto: (id: string, size: 'thumb' | 'full', version: string) => requestPhoto(id, size, version),

  // DELETE /foods/:id/photo
  removeFoodPhoto: (id: string) => request<void>('DELETE', `/foods/${id}/photo`),

  // GET /insights
  insights: () => request<Insights>('GET', '/insights'),

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
  // GET /notifications/delivery
  delivery: () => request<ReminderDelivery>('GET', '/notifications/delivery'),
  // PUT /notifications/delivery
  updateDelivery: (body: DeliveryInput) => request<ReminderDelivery>('PUT', '/notifications/delivery', body),

  // GET /notifications/alerts
  alerts: () => request<AlertSettings>('GET', '/notifications/alerts'),
  // PUT /notifications/alerts
  updateAlerts: (body: AlertSettingsInput) => request<AlertSettings>('PUT', '/notifications/alerts', body),
  // GET /notifications/meals
  mealReminders: () => request<MealReminders>('GET', '/notifications/meals'),
  // PUT /notifications/meals
  updateMealReminders: (body: MealRemindersInput) => request<MealReminders>('PUT', '/notifications/meals', body),
  // GET /meal-reminders/:meal
  mealReminder: (meal: MealType) => request<MealReminderView>('GET', `/meal-reminders/${meal}`),

  // GET /push/config
  pushConfig: () => request<PushConfig>('GET', '/push/config'),
  // POST /push/subscriptions
  subscribePush: (body: PushSubscriptionInput) => request<PushDevice>('POST', '/push/subscriptions', body),
  // DELETE /push/subscriptions
  unsubscribePush: (which: string | { token: string }, authToken?: string) =>
    request<void>('DELETE', '/push/subscriptions', typeof which === 'string' ? { endpoint: which } : which, authToken),
  // POST /push/actions
  pushAction: (body: PushActionInput) => request<void>('POST', '/push/actions', body),

  // GET /ai/status
  aiStatus: () => request<AiStatus>('GET', '/ai/status'),
  // POST /ai/recipes
  suggestRecipes: (mealType?: MealType) =>
    request<RecipeIdeas>('POST', '/ai/recipes', mealType ? { mealType } : undefined),
  // POST /ai/meal-plan
  suggestMealPlan: () => request<MealPlanDraft>('POST', '/ai/meal-plan'),

  // GET /meal-plan
  mealPlan: () => request<MealPlan>('GET', '/meal-plan'),
  // PUT /meal-plan/:date
  setMeal: (date: string, body: MealPlanEntryInput) => request<MealPlanEntry>('PUT', `/meal-plan/${date}`, body),
  // DELETE /meal-plan/:date?meal=
  clearMeal: (date: string, meal: MealType = 'dinner') => request<void>('DELETE', `/meal-plan/${date}?meal=${meal}`),

  // GET /shopping
  shopping: () => request<{ items: ShoppingItem[] }>('GET', '/shopping'),
  // POST /shopping
  addShopping: (body: ShoppingItemInput) => request<ShoppingItem>('POST', '/shopping', body),
  // PUT /shopping/:id
  updateShopping: (id: string, body: ShoppingUpdateInput) => request<ShoppingItem>('PUT', `/shopping/${id}`, body),
  // DELETE /shopping/:id
  removeShopping: (id: string) => request<void>('DELETE', `/shopping/${id}`),
  // POST /shopping/clear-checked
  clearCheckedShopping: () => request<void>('POST', '/shopping/clear-checked'),
};
