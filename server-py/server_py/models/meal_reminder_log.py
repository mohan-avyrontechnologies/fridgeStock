"""Which meal reminders were sent, so each is sent once a day (server/src/models/MealReminderLog.ts)."""

from server_py.models.base import Model, index

MEAL_REMINDER_LOG = Model(
    "MealReminderLog",
    "mealreminderlogs",
    (
        index(("userId", 1), ("date", 1), ("meal", 1), unique=True),
        # Kept for a week.
        index(("createdAt", 1), expire_after_seconds=7 * 24 * 60 * 60),
    ),
)
