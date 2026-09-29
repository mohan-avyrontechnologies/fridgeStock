export type Urgency = 'NOT_URGENT' | 'USE_SOON' | 'DUE_TODAY' | 'PAST_EXPECTED_EXPIRY';
export type FoodStatus = 'ACTIVE' | 'USED' | 'WASTED' | 'REMOVED';
export type UsageAction = 'USED' | 'PARTIALLY_USED' | 'WASTED' | 'REMOVED';
export type ReminderType = 'APPROACHING_EXPIRY' | 'DUE' | 'OVERDUE';

export interface NotificationPreferences {
  approachingExpiry: boolean;
  due: boolean;
  overdue: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  timeZone: string;
  notificationPreferences: NotificationPreferences;
}

export interface FoodItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  addedDate: string;
  lifespanDays: number;
  expectedExpiryDate: string;
  status: FoodStatus;
  remainingDays: number | null;
  urgency: Urgency | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An item from the active list always has remaining days and urgency. */
export type ActiveFoodItem = FoodItem & { remainingDays: number; urgency: Urgency };

export interface FoodInput {
  name: string;
  quantity: number;
  unit: string;
  addedDate: string;
  lifespanDays: number;
}

export interface FoodList {
  today: string;
  summary: Record<Urgency, number>;
  items: ActiveFoodItem[];
}

export interface UsageRecord {
  id: string;
  foodId: string;
  foodName: string;
  unit: string;
  action: UsageAction;
  date: string;
  quantityUsed: number;
  quantityRemaining: number;
}

export interface AppNotification {
  id: string;
  foodId: string;
  type: ReminderType;
  message: string;
  scheduledDate: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  sentAt: string | null;
  readAt: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
}
