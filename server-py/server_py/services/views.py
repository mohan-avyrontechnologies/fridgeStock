"""Documents mapped to the API's response shapes (server/src/services/views.ts). Never exposes passwordHash."""

from typing import Any

from server_py.models.user import UserDoc
from server_py.services.user_settings import alerts_of, meal_reminders_of


def _or(value: Any, default: Any) -> Any:
    return default if value is None else value


def to_user_view(user: UserDoc) -> dict[str, Any]:
    preferences: dict[str, Any] = user.get("notificationPreferences") or {}
    delivery: dict[str, Any] = user.get("reminderDelivery") or {}
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "timeZone": user.time_zone,
        "currency": _or(user.get("currency"), "USD"),
        "savePhotos": _or(user.get("savePhotos"), True),
        "firstRunDone": _or(user.get("firstRunDone"), True),
        "notificationPreferences": {
            "approachingExpiry": preferences.get("approachingExpiry"),
            "due": preferences.get("due"),
            "overdue": preferences.get("overdue"),
        },
        "reminderDelivery": {"mode": delivery.get("mode"), "hour": delivery.get("hour")},
        "alerts": alerts_of(user),
        "mealReminders": meal_reminders_of(user),
    }
