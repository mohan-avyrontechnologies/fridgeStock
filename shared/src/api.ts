import type { DateString } from './dates.js';
import type {
  ActivityType,
  WarningSignType,
  Currency,
  ExpirySource,
  FoodStatus,
  MealType,
  NotificationChannelId,
  PushActionName,
  PushKind,
  SoundName,
  NotificationStatus,
  PreferenceKey,
  PrintedDateType,
  PushPlatform,
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

/** Sound, vibration and quiet hours for reminders. */
export interface AlertSettings {
  /** Play reminder sounds. Off: reminders arrive without a sound. */
  sound: boolean;
  /** Vibrate for urgent reminders (Android and browsers; iPhones can't vibrate per notification). */
  vibration: boolean;
  quietHours: {
    enabled: boolean;
    /** "HH:mm" in the user's time zone. The period may cross midnight (22:00 to 07:00). */
    start: string;
    end: string;
  };
}

/** One meal's cooking reminder. */
export interface MealReminderSetting {
  enabled: boolean;
  /** "HH:mm" in the user's time zone. */
  time: string;
}

export type MealReminders = Record<MealType, MealReminderSetting>;

export interface User {
  id: string;
  name: string;
  email: string;
  timeZone: string;
  notificationPreferences: NotificationPreferences;
  reminderDelivery: ReminderDelivery;
  /** Sound, vibration and quiet hours. Left out by servers older than v2.17. */
  alerts?: AlertSettings;
  /** Breakfast, lunch and dinner cooking reminders. Left out by servers older than v2.17. */
  mealReminders?: MealReminders;
  /** Currency prices are shown in. */
  currency: Currency;
  /** Whether a photo taken with the camera is kept with the food item (on by default). */
  savePhotos: boolean;
  /**
   * Whether the first-run guide has been seen (or skipped). New accounts start with `false`; accounts made
   * before the guide existed count as done. Left out by servers older than v2.21.
   */
  firstRunDone?: boolean;
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
  /** Where the expected expiry came from. USER once the person has edited it. */
  expirySource: ExpirySource;
  /** One short sentence saying why the expected expiry is what it is. */
  estimateExplanation: string;
  /** A date read off the pack, if one was found, and what it was called. */
  printedDate: DateString | null;
  printedDateType: PrintedDateType | null;
  notes: string | null;
  storage: StorageLocation;
  openedDate: DateString | null;
  /** Leftovers from a cooked meal: a new item with a short lifespan. */
  leftover: boolean;
  /** What the whole quantity cost, if the user entered it. */
  price: number | null;
  /** When the item's photo was last set, or null when it has none. Also the photo's version. */
  photoAt: string | null;
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
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; field?: string };
}

/** GET /push/config: the VAPID public key, or null when push isn't set up on this server. */
export interface PushConfig {
  publicKey: string | null;
  /** Push to the Android and iOS apps is set up (Firebase). */
  native: boolean;
}

/** A browser or app registered for push reminders. */
export interface PushDevice {
  id: string;
  platform: PushPlatform;
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
  actions: { action: PushActionName; title: string; /** A page to open, for buttons that open one. */ url?: string }[];
  /** Lets the service worker call POST /push/actions without the login token. Only on single-item and meal pushes. */
  actionToken?: string;
  /** What the push is about. */
  kind: PushKind;
  /** The Android channel it goes to (sound and vibration are set by the channel). */
  channel: NotificationChannelId;
  /** The sound to play, or null for none (the person turned sounds off, or it is quiet hours). */
  sound: SoundName | null;
  /** A vibration pattern in milliseconds (on, off, on…), or empty for none. */
  vibrate: number[];
  /** Stay on screen until the person acts on it. Only for due and overdue reminders. */
  requireInteraction: boolean;
  /** Quiet hours or sound switched off: no sound and no vibration. */
  silent: boolean;
}

// ---- Meal reminders ----

/** A recipe idea, with the meal it suits. */
export interface MealRecipe {
  title: string;
  minutes: number;
  steps: string[];
  uses: FoodRef[];
}

/** What a meal reminder says, and where it came from. */
export type MealContent =
  | { source: 'plan'; title: string; foods: FoodRef[] }
  | { source: 'recipe'; recipe: MealRecipe }
  | { source: 'items'; items: { id: string; name: string; remainingDays: number }[] };

/** GET /meal-reminders/:meal: what today's reminder for this meal showed (for "Show recipe"). */
export interface MealReminderView {
  meal: MealType;
  date: DateString;
  content: MealContent;
}

// ---- Phase 4: using the food ----

/** GET /ai/status. AI features are shown only when `enabled`. */
export interface AiStatus {
  enabled: boolean;
  /** Photo Check is on: the feature flag is set and AI is enabled. */
  photoCheck: boolean;
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
  /** Which meal it is. Plans made before meals were added are dinners. */
  meal: MealType;
  title: string;
  foods: (FoodRef & { status: FoodStatus })[];
}

/** GET /meal-plan: today and the next six days. */
export interface MealPlan {
  today: DateString;
  /** `entry` is the dinner; `meals` has whichever of breakfast, lunch and dinner are planned. */
  days: { date: DateString; entry: MealPlanEntry | null; meals?: Partial<Record<MealType, MealPlanEntry>> }[];
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

export interface HouseholdMember {
  id: string;
  name: string;
  isYou: boolean;
}

/** An invite someone in the household created; the code is shared by hand (nothing is emailed). */
export interface HouseholdInvite {
  /** Eight letters and digits, shown as XXXX-XXXX. */
  code: string;
  expiresAt: string;
  createdBy: string;
}

/** The signed-in user's household. Everyone is always in one: alone, with just themselves. */
export interface Household {
  members: HouseholdMember[];
  /** Open invites from this household. */
  invites: HouseholdInvite[];
  maxMembers: number;
}

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  /** Name of who did it ("A former member" if they have since left or deleted their account). */
  actor: string;
  /** The food, for food events. */
  foodName: string | null;
  /** When it happened (ISO timestamp). */
  at: string;
}

export interface ActivityLog {
  items: ActivityEvent[];
  hasMore: boolean;
}

/** A product found by barcode (from Open Food Facts), or "not found". Names are as the maker printed them. */
export interface ProductLookup {
  found: boolean;
  barcode: string;
  name: string | null;
  brand: string | null;
  /** The pack size, when the product lists one in a unit the app knows. */
  quantity: number | null;
  unit: Unit | null;
}

/** One food line read from a receipt. A draft: nothing is saved until the person reviews it. */
export interface ReceiptItem {
  name: string;
  quantity: number;
  unit: Unit;
  /** What this line cost, if the receipt shows it. */
  price: number | null;
}

export interface ReceiptDraft {
  /** The shopping date printed on the receipt, if it is clear and not in the future. */
  purchaseDate: DateString | null;
  items: ReceiptItem[];
}

/** A problem a photo shows. The app never reports anything good about a photo. */
export interface WarningSign {
  type: WarningSignType;
  description: string;
}

/** What the AI made of a photo of food. There is no field for good or normal condition. */
export interface PhotoCheck {
  name: string;
  category: string;
  /** How sure the identification is, from 0 to 1. */
  confidence: number;
  /** Visible problems only; empty when none were seen (which is never shown as a result). */
  warningSigns: WarningSign[];
}
