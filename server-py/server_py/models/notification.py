"""Reminders (server/src/models/Notification.ts)."""

from typing import Any, Final

from bson import ObjectId

from server_py.models.base import Document, Model, index, save
from server_py.services import clock
from server_py.shared.enums import ReminderType

NOTIFICATION: Final = Model(
    "Notification",
    "notifications",
    (
        index(("foodId", 1)),
        # One reminder of each type per item and expected expiry.
        index(("userId", 1), ("foodId", 1), ("type", 1), ("expiryDate", 1), unique=True),
        index(("userId", 1), ("status", 1), ("scheduledDate", 1)),
        index(("userId", 1), ("sentAt", -1)),
    ),
    shard_key=("userId",),
)

MAX_DELIVERY_ATTEMPTS: Final = 3

# Reminders that haven't been delivered yet.
OPEN_STATUSES: Final = ("PENDING", "FAILED")


class NotificationDoc(Document):
    def __init__(self, stored: dict[str, Any]) -> None:
        super().__init__(stored, defaults={"status": "PENDING", "attempts": 0})


async def delete_open_for_food(user_id: ObjectId, food_id: ObjectId) -> None:
    await NOTIFICATION.collection().delete_many(
        {"userId": user_id, "foodId": food_id, "status": {"$in": list(OPEN_STATUSES)}}
    )


async def schedule(user_id: ObjectId, food_id: ObjectId, kind: ReminderType, expiry_date: str, date: str) -> None:
    """Create the reminder unless it exists already (an upsert, as Mongoose writes it: the filter's fields, then
    the inserted ones with __v and createdAt, and updatedAt)."""
    now = clock.system_now()
    await NOTIFICATION.collection().update_one(
        {"userId": user_id, "foodId": food_id, "type": kind, "expiryDate": expiry_date},
        {
            "$setOnInsert": {"scheduledDate": date, "status": "PENDING", "attempts": 0, "__v": 0, "createdAt": now},
            "$set": {"updatedAt": now},
        },
        upsert=True,
    )


async def find_due(user_id: ObjectId, today: str) -> list[NotificationDoc]:
    """This user's reminders whose day has come: pending ones, and failed ones with attempts left."""
    cursor = NOTIFICATION.collection().find(
        {
            "userId": user_id,
            "scheduledDate": {"$lte": today},
            "$or": [{"status": "PENDING"}, {"status": "FAILED", "attempts": {"$lt": MAX_DELIVERY_ATTEMPTS}}],
        }
    )
    return [NotificationDoc(stored) async for stored in cursor]


async def delete(notification: NotificationDoc) -> None:
    """`notification.deleteOne()`: by id, with the shard key."""
    await NOTIFICATION.collection().delete_one({"_id": notification.id, "userId": notification.stored["userId"]})


async def save_notification(notification: NotificationDoc) -> None:
    await save(NOTIFICATION, notification)
