import type { DateString } from './dates.js';
import type {
  Currency,
  FoodStatus,
  NotificationStatus,
  PreferenceKey,
  PushAction,
  ReminderMode,
  ReminderType,
  StorageLocation,
  Unit,
  UsageAction,
  Urgency,
} from './enums.js';

/** Response shapes of the REST API (`/api`). */

export type NotificationPreferences = Record<PreferenceKey, boolean>;

/** How and when push reminders arrive. In-app reminders under the bell are not affected. */
export interface ReminderDelivery {
  mode: ReminderMode;
  /** Hour of the day (0–23, in the user's time zone) when push reminders go out. */
  hour: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  timeZone: string;
  notificationPreferences: NotificationPreferences;
  reminderDelivery: ReminderDelivery;
  /** Currency prices are shown in. */
  currency: Currency;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface FoodItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  addedDate: DateString;
  lifespanDays: number;
  /** Always addedDate + lifespanDays, calculated by the server (never accepted from the client). */
  expiryDate: DateString;
  notes: string | null;
  storage: StorageLocation;
  openedDate: DateString | null;
  /** Leftovers from a cooked meal: a new item with a short lifespan. */
  leftover: boolean;
  /** What the whole quantity cost, if the user entered it. */
  price: number | null;
  status: FoodStatus;
  /** Only while the item is active. */
  remainingDays: number | null;
  urgency: Urgency | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An item from the active list always has remaining days and urgency. */
export type ActiveFoodItem = FoodItem & { remainingDays: number; urgency: Urgency };

/** How many active items are in each urgency state, plus the total. */
export type UrgencySummary = Record<Urgency, number> & { total: number };

export interface FoodList {
  today: DateString;
  summary: UrgencySummary;
  items: ActiveFoodItem[];
}

export interface BulkCreateResult {
  items: FoodItem[];
}

export interface Favourite {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  lifespanDays: number;
  storage: StorageLocation;
}

/** A lifespan the user usually sets for a food in a location, learned from their own items. */
export interface LearnedLifespan {
  name: string;
  storage: StorageLocation;
  unit: Unit;
  /** Median of the lifespans they entered, in days. */
  days: number;
  /** How many of their items this is based on (at least 2). */
  basedOn: number;
}

export interface CookFirstList {
  today: DateString;
  items: ActiveFoodItem[];
}

export interface UsageRecord {
  id: string;
  foodId: string;
  foodName: string;
  unit: string;
  action: UsageAction;
  /** The user's calendar day when the action was recorded. */
  date: DateString;
  /** Exact time the action was recorded (ISO timestamp). */
  recordedAt: string;
  quantityUsed: number;
  quantityRemaining: number;
  /** The price of the quantity used or wasted, when the item had a price. */
  value: number | null;
}

export interface UsageResult {
  food: FoodItem;
  usageRecord: UsageRecord;
}

export interface AppNotification {
  id: string;
  foodId: string;
  type: ReminderType;
  message: string;
  scheduledDate: DateString;
  status: NotificationStatus;
  sentAt: string | null;
  readAt: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export type UsageHistory = Page<UsageRecord> & { counts: Record<UsageAction, number> };
/** A page of delivered (SENT) or FAILED reminders, newest first (up to 50 per page). */
export interface NotificationFeed {
  items: AppNotification[];
  total: number;
  unread: number;
}

/** Every error the API returns. Never includes a stack trace. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; field?: string };
}

/** GET /push/config: the VAPID public key, or null when push isn't set up on this server. */
export interface PushConfig {
  publicKey: string | null;
}

/** A browser registered for push reminders. */
export interface PushDevice {
  id: string;
  browser: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What the service worker receives in a push message. All wording comes from the server. */
export interface PushPayload {
  title: string;
  body: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag: string;
  /** Page opened when the notification is tapped, or when an action can't be completed. */
  url: string;
  actions: { action: PushAction; title: string }[];
  /** Lets the service worker call POST /push/actions without the login token. Only on single-item pushes. */
  actionToken?: string;
}

// ---- Phase 4: using the food ----

/** GET /ai/status. AI features are shown only when `enabled`. */
export interface AiStatus {
  enabled: boolean;
  dailyLimit: number;
  usedToday: number;
}

/** A food item referred to by an AI suggestion or a meal plan entry. */
export interface FoodRef {
  id: string;
  name: string;
}

/** One recipe idea built from the Cook First list. */
export interface RecipeIdea {
  title: string;
  minutes: number;
  /** Items from your list that it uses, most urgent first. */
  uses: FoodRef[];
  steps: string[];
}

/** POST /ai/recipes */
export interface RecipeIdeas {
  /** The Cook First list the ideas were built from, in its (unchanged) order. */
  basedOn: FoodRef[];
  recipes: RecipeIdea[];
}

/** An active item already at home that matches a shopping list entry. */
export interface AtHomeMatch {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiryDate: DateString;
  urgency: Urgency;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  checked: boolean;
  createdAt: string;
  /** Matching food you already have, so you don't buy it twice. */
  atHome: AtHomeMatch[];
}

export interface MealPlanEntry {
  title: string;
  foods: (FoodRef & { status: FoodStatus })[];
}

/** GET /meal-plan: today and the next six days. */
export interface MealPlan {
  today: DateString;
  days: { date: DateString; entry: MealPlanEntry | null }[];
}

/** POST /ai/meal-plan: a draft for the empty days. Nothing is saved until the user adds it. */
export interface MealPlanDraft {
  days: { date: DateString; title: string; foods: FoodRef[] }[];
}

/** Used and wasted food over a window of days (from the usage history; REMOVED entries are left out). */
export interface InsightsPeriod {
  /** Items used (fully or partly). */
  used: number;
  wasted: number;
  /** Wasted as a share of used + wasted (0 to 1), or null when nothing was recorded. */
  wasteRate: number | null;
  /** Total price of what was used, from items that had a price. */
  savedValue: number;
  /** Total price of what was wasted, from items that had a price. */
  lostValue: number;
  /** How many of the used and wasted entries had a price. */
  pricedEntries: number;
}

export interface InsightsWeek extends InsightsPeriod {
  /** First day of this 7-day week. */
  from: DateString;
  to: DateString;
}

export interface InsightsWastedFood {
  name: string;
  count: number;
  lostValue: number;
}

export interface InsightsTip {
  id: string;
  text: string;
}

export interface Insights {
  today: DateString;
  /** The last seven days, today included. */
  thisWeek: InsightsPeriod;
  /** The seven days before that. */
  lastWeek: InsightsPeriod;
  last30Days: InsightsPeriod;
  /** Eight 7-day weeks, oldest first; the last one ends today. */
  weeks: InsightsWeek[];
  /** Most wasted foods in the last 30 days, most first (at most 5). */
  topWasted: InsightsWastedFood[];
  /** Short tips from the numbers above; empty when there is nothing to say. */
  tips: InsightsTip[];
}

/** One JSON file with everything the app holds about the user (never the password hash or push keys). */
export interface AccountExport {
  exportedAt: string;
  account: User;
  /** How many devices have push reminders on (their keys are not exported). */
  pushDevices: number;
  foods: Record<string, unknown>[];
  history: Record<string, unknown>[];
  reminders: Record<string, unknown>[];
  favourites: Record<string, unknown>[];
  shopping: Record<string, unknown>[];
  mealPlan: Record<string, unknown>[];
}
