"""Reminders (server/src/services/notificationService.ts). Phase 2 has what food changes need: scheduling an
item's reminders for its household, cancelling them, and delivering due ones in the app. The feed, settings and
push arrive in Phase 4.
"""

import logging
from typing import Final

from bson import ObjectId

from server_py import messages
from server_py.config.urgency import APPROACHING_EXPIRY_DAYS
from server_py.models import food_item, notification
from server_py.models import user as users
from server_py.models.food_item import FoodDoc
from server_py.models.notification import NotificationDoc
from server_py.models.user import UserDoc
from server_py.services import clock
from server_py.shared.dates import DateString, add_days, diff_days
from server_py.shared.enums import REMINDER_TYPES, PreferenceKey, ReminderType

log = logging.getLogger(__name__)

PREFERENCE_FOR: Final[dict[ReminderType, PreferenceKey]] = {
    "APPROACHING_EXPIRY": "approachingExpiry",
    "DUE": "due",
    "OVERDUE": "overdue",
}


class InAppDelivery:
    """In-app delivery: a reminder is delivered by making it visible in the user's feed. An object so tests can
    make delivery fail. Push is a separate, optional layer and never affects in-app delivery."""

    async def deliver(self, notification: NotificationDoc) -> None:
        return None


delivery_channel = InAppDelivery()


def scheduled_date_for(kind: ReminderType, expiry_date: DateString, today: DateString) -> DateString | None:
    """When each reminder type is scheduled, for an item with this expiry date:
    - APPROACHING_EXPIRY: 3 days before expiry, or today if that has passed; only if that is before expiry.
    - DUE: on the expiry date, only if that is today or later.
    - OVERDUE: the day after expiry, or today if that has passed.
    None when the type shouldn't be created."""

    def not_before(date: DateString) -> DateString:
        return today if date < today else date

    if kind == "APPROACHING_EXPIRY":
        date = not_before(add_days(expiry_date, -APPROACHING_EXPIRY_DAYS))
        return date if date < expiry_date else None
    if kind == "DUE":
        return expiry_date if expiry_date >= today else None
    return not_before(add_days(expiry_date, 1))


async def cancel_for_food(user_id: ObjectId, food_id: ObjectId) -> None:
    await notification.delete_open_for_food(user_id, food_id)


def _wants(user: UserDoc, kind: ReminderType) -> bool:
    return bool(user.get(f"notificationPreferences.{PREFERENCE_FOR[kind]}"))


async def schedule_for_food(food: FoodDoc, user: UserDoc) -> None:
    """(Re)creates the reminders for one item. A stage the item has already moved past is skipped; the stage it
    is in now is scheduled for today, so a backdated item gets one relevant reminder rather than a burst of stale
    ones."""
    await cancel_for_food(user.id, food.id)
    if food["status"] != "ACTIVE":
        return
    today = clock.today(user.time_zone)
    for kind in REMINDER_TYPES:
        if not _wants(user, kind):
            continue
        date = scheduled_date_for(kind, food["expiryDate"], today)
        if date:
            await notification.schedule(user.id, food.id, kind, food["expiryDate"], date)


async def schedule_for_household(food: FoodDoc) -> None:
    """Schedules an item's reminders for everyone in its household (each member has their own reminders,
    settings and time zone)."""
    for member in await users.find_in_household(food["householdId"]):
        await schedule_for_food(food, member)


def _message_for(kind: ReminderType, food: FoodDoc, today: DateString) -> str:
    """The reminder's text; the number of days is worked out now, at the moment of sending."""
    if kind == "APPROACHING_EXPIRY":
        return messages.reminder_approaching(food["name"], diff_days(today, food["expiryDate"]))
    if kind == "DUE":
        return messages.reminder_due(food["name"])
    return messages.reminder_overdue(food["name"])


async def dispatch_due(user: UserDoc) -> None:
    """Marks this user's pending reminders as sent once their day has come in the user's time zone, provided the
    item is still active and the reminder type still wanted. A failed send is marked FAILED and retried on later
    runs, up to MAX_DELIVERY_ATTEMPTS. Runs at the start of GET /notifications and GET /foods, and from the job."""
    today = clock.today(user.time_zone)
    for due in await notification.find_due(user.id, today):
        food = await food_item.find_in_household(due["foodId"], user.household_id)
        if (
            food is None
            or food["status"] != "ACTIVE"
            or food["expiryDate"] != due["expiryDate"]
            or not _wants(user, due["type"])
        ):
            await notification.delete(due)
            continue
        due["attempts"] = due["attempts"] + 1
        due["message"] = _message_for(due["type"], food, today)
        try:
            await delivery_channel.deliver(due)
            due["status"] = "SENT"
            due["sentAt"] = clock.now()
            due.unset("lastError")
        except Exception as error:
            # Failures stay visible as FAILED and are retried on later sweeps. Inventory views never depend on this.
            due["status"] = "FAILED"
            due["lastError"] = str(error)
        await notification.save_notification(due)
