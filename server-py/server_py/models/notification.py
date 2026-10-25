"""Reminders (server/src/models/Notification.ts)."""

from server_py.models.base import Model, index

NOTIFICATION = Model(
    "Notification",
    "notifications",
    (
        index(("foodId", 1)),
        # One reminder of each type per item and expected expiry.
        index(("userId", 1), ("foodId", 1), ("type", 1), ("expiryDate", 1), unique=True),
        index(("userId", 1), ("status", 1), ("scheduledDate", 1)),
        index(("userId", 1), ("sentAt", -1)),
    ),
)
