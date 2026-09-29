import type { DateString } from './dates.js';
import type {
  FoodStatus,
  NotificationStatus,
  PreferenceKey,
  ReminderType,
  Unit,
  UsageAction,
  Urgency,
} from './enums.js';

/** Response shapes of the REST API (`/api`). */

export type NotificationPreferences = Record<PreferenceKey, boolean>;

export interface User {
  id: string;
  name: string;
  email: string;
  timeZone: string;
  notificationPreferences: NotificationPreferences;
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
/** Up to 50 delivered (SENT) or FAILED reminders, newest first. */
export interface NotificationFeed {
  items: AppNotification[];
  unread: number;
}

/** Every error the API returns. Never includes a stack trace. */
export const ERROR_CODES = ['VALIDATION_ERROR', 'UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; field?: string };
}
