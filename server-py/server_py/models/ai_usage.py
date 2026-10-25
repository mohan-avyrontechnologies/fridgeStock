"""AI requests per person per day (server/src/models/AiUsage.ts)."""

from typing import Any

from bson import ObjectId

from server_py.models.base import Model, index

AI_USAGE = Model("AiUsage", "aiusages", (index(("userId", 1), ("date", 1), unique=True),))


async def find_for_day(user_id: ObjectId, date: str) -> dict[str, Any] | None:
    """One person's count for one calendar day, if they made any AI request that day."""
    return await AI_USAGE.collection().find_one({"userId": user_id, "date": date})
