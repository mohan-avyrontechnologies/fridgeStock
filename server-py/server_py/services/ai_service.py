"""AI features (server/src/services/aiService.ts). Phase 1 has the status the app asks for."""

from typing import Any

from server_py.config.ai import AI_DAILY_LIMIT
from server_py.config.features import photo_check_enabled
from server_py.models import ai_usage
from server_py.models.user import UserDoc
from server_py.services import clock
from server_py.services.ai_client import ai_client


async def status(user: UserDoc) -> dict[str, Any]:
    usage = await ai_usage.find_for_day(user.id, clock.today(user.time_zone))
    enabled = ai_client() is not None
    return {
        "enabled": enabled,
        "photoCheck": enabled and photo_check_enabled(),
        "dailyLimit": AI_DAILY_LIMIT,
        "usedToday": (usage or {}).get("count") or 0,
    }
