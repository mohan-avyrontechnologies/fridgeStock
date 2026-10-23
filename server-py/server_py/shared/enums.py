"""Enumerations shared by client and server (shared/src/enums.ts). Each is a tuple plus its Literal type."""

from typing import Literal, get_args

Urgency = Literal["NOT_URGENT", "APPROACHING_EXPIRY", "DUE", "OVERDUE"]
"""Derived from remaining days every time items are read; never stored."""
URGENCIES: tuple[Urgency, ...] = get_args(Urgency)

Unit = Literal["pcs", "g", "kg", "ml", "l", "pack", "bunch"]
UNITS: tuple[Unit, ...] = get_args(Unit)

StorageLocation = Literal["FRIDGE", "FREEZER", "PANTRY"]
STORAGE_LOCATIONS: tuple[StorageLocation, ...] = get_args(StorageLocation)

FoodStatus = Literal["ACTIVE", "USED", "WASTED", "REMOVED"]
"""Stored lifecycle status of a food item. A partly used item stays ACTIVE."""
FOOD_STATUSES: tuple[FoodStatus, ...] = get_args(FoodStatus)

UsageAction = Literal["USED", "PARTIALLY_USED", "WASTED", "REMOVED"]
USAGE_ACTIONS: tuple[UsageAction, ...] = get_args(UsageAction)

Currency = Literal["USD", "EUR", "GBP", "CAD", "AUD", "INR"]
CURRENCIES: tuple[Currency, ...] = get_args(Currency)

WarningSignType = Literal[
    "MOULD", "DISCOLOURATION", "WILTING", "SLIME", "BRUISING", "DAMAGED_PACKAGING", "SWOLLEN_PACKAGING", "OTHER"
]
"""What a photo check can point out. There is deliberately no value for "looks fine"."""
WARNING_SIGN_TYPES: tuple[WarningSignType, ...] = get_args(WarningSignType)

ActivityType = Literal[
    "FOOD_ADDED", "USED", "PARTIALLY_USED", "WASTED", "REMOVED", "MEMBER_JOINED", "MEMBER_LEFT", "PHOTO_CHECKED"
]
ACTIVITY_TYPES: tuple[ActivityType, ...] = get_args(ActivityType)

ReminderType = Literal["APPROACHING_EXPIRY", "DUE", "OVERDUE"]
REMINDER_TYPES: tuple[ReminderType, ...] = get_args(ReminderType)

NotificationStatus = Literal["PENDING", "SENT", "FAILED"]
NOTIFICATION_STATUSES: tuple[NotificationStatus, ...] = get_args(NotificationStatus)

PreferenceKey = Literal["approachingExpiry", "due", "overdue"]
PREFERENCE_KEYS: tuple[PreferenceKey, ...] = get_args(PreferenceKey)

ReminderMode = Literal["DIGEST", "EACH_ITEM"]
"""How push reminders arrive: one summary a day, or one per reminder."""
REMINDER_MODES: tuple[ReminderMode, ...] = get_args(ReminderMode)

PushPlatform = Literal["web", "android", "ios"]
PUSH_PLATFORMS: tuple[PushPlatform, ...] = get_args(PushPlatform)

PushAction = Literal["USED", "SNOOZE"]
"""Buttons inside a push notification."""
PUSH_ACTIONS: tuple[PushAction, ...] = get_args(PushAction)

MealType = Literal["breakfast", "lunch", "dinner"]
MEAL_TYPES: tuple[MealType, ...] = get_args(MealType)

MealPushAction = Literal["COOKED", "RECIPE", "SNOOZE_MEAL"]
"""COOKED and RECIPE open a page; SNOOZE_MEAL calls the API to be reminded again in 30 minutes."""
MEAL_PUSH_ACTIONS: tuple[MealPushAction, ...] = get_args(MealPushAction)

PushKind = Literal["APPROACHING_EXPIRY", "DIGEST", "DUE", "OVERDUE", "MEAL"]
"""What a push is about. It decides which sound, channel and vibration it gets."""
PUSH_KINDS: tuple[PushKind, ...] = get_args(PushKind)

SoundName = Literal["gentle", "strong", "meal"]
SOUND_NAMES: tuple[SoundName, ...] = get_args(SoundName)

NotificationChannelId = Literal[
    "food-soon", "food-urgent", "meal-reminders", "food-urgent-sound", "reminders-vibrate", "reminders-silent"
]
NOTIFICATION_CHANNELS: tuple[NotificationChannelId, ...] = get_args(NotificationChannelId)

FoodCategory = Literal["MEAT_FISH", "DAIRY_EGGS", "VEGETABLES", "FRUIT", "BAKERY", "COOKED", "CHILLED_PACKAGED"]
FOOD_CATEGORIES: tuple[FoodCategory, ...] = get_args(FoodCategory)

ExpirySource = Literal["PRINTED_DATE", "LEARNED", "CATALOG", "CATEGORY_DEFAULT", "FALLBACK", "USER"]
"""Where an item's expected expiry came from. USER means the person typed it in."""
EXPIRY_SOURCES: tuple[ExpirySource, ...] = get_args(ExpirySource)

PrintedDateType = Literal["USE_BY", "BEST_BEFORE", "EXPIRY", "UNKNOWN"]
PRINTED_DATE_TYPES: tuple[PrintedDateType, ...] = get_args(PrintedDateType)
