"""Documents mapped to the API's response shapes (server/src/services/views.ts). Never exposes passwordHash."""

from datetime import datetime
from typing import Any

from server_py.models.favourite import FavouriteDoc
from server_py.models.food_item import FoodDoc
from server_py.models.usage_record import UsageRecordDoc
from server_py.models.user import UserDoc
from server_py.services.priority_engine import classify_urgency
from server_py.services.user_settings import alerts_of, meal_reminders_of
from server_py.shared.dates import DateString, diff_days
from server_py.shared.estimate_copy import USER_EXPLANATION
from server_py.shared.js import iso_string, math_round


def _or(value: Any, default: Any) -> Any:
    return default if value is None else value


def _iso(moment: datetime | None) -> str | None:
    return iso_string(moment) if moment else None


def _current_price(food: FoodDoc) -> float | None:
    """The price of what is left: a partly used item's price shrinks with its quantity."""
    price, price_quantity = food["price"], food["priceQuantity"]
    if price is None:
        return None
    if not price_quantity:
        return price
    return math_round(price * food["quantity"] / price_quantity * 100) / 100


def to_food_view(food: FoodDoc, today: DateString) -> dict[str, Any]:
    remaining = diff_days(today, food["expiryDate"]) if food["status"] == "ACTIVE" else None
    return {
        "id": str(food.id),
        "name": food["name"],
        "quantity": food["quantity"],
        "unit": food["unit"],
        "addedDate": food["addedDate"],
        "lifespanDays": food["lifespanDays"],
        "expiryDate": food["expiryDate"],
        "expirySource": _or(food["expirySource"], "USER"),
        "estimateExplanation": food["estimateExplanation"] or USER_EXPLANATION,
        "printedDate": food["printedDate"],
        "printedDateType": food["printedDateType"],
        "notes": food["notes"],
        "storage": _or(food["storage"], "FRIDGE"),
        "openedDate": food["openedDate"],
        "leftover": _or(food["leftover"], False),
        "price": _current_price(food),
        "photoAt": _iso(food["photoAt"]),
        "status": food["status"],
        "remainingDays": remaining,
        "urgency": None if remaining is None else classify_urgency(remaining),
        "closedAt": _iso(food["closedAt"]),
        "createdAt": iso_string(food["createdAt"]),
        "updatedAt": iso_string(food["updatedAt"]),
    }


def to_usage_view(record: UsageRecordDoc) -> dict[str, Any]:
    return {
        "id": str(record.id),
        "foodId": str(record["foodId"]),
        "foodName": record["foodName"],
        "unit": record["unit"],
        "action": record["action"],
        "date": record["date"],
        "recordedAt": iso_string(record["createdAt"]),
        "quantityUsed": record["quantityUsed"],
        "quantityRemaining": record["quantityRemaining"],
        "value": record["value"],
    }


def to_favourite_view(favourite: FavouriteDoc) -> dict[str, Any]:
    return {
        "id": str(favourite.id),
        "name": favourite["name"],
        "quantity": favourite["quantity"],
        "unit": favourite["unit"],
        "lifespanDays": favourite["lifespanDays"],
        "storage": favourite["storage"],
    }


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
