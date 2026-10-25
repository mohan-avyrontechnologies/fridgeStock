"""A person's reminder settings, with the defaults for anything never set (server/src/services/userSettings.ts)."""

from typing import Any

from server_py.models.user import UserDoc
from server_py.shared.alerts import DEFAULT_ALERTS, DEFAULT_MEAL_REMINDERS, AlertSettings, MealSetting
from server_py.shared.enums import MealType


def _or(value: Any, default: Any) -> Any:
    """JavaScript's `value ?? default`."""
    return default if value is None else value


def alerts_of(user: UserDoc) -> AlertSettings:
    """Sound, vibration and quiet hours. Anyone who has never changed them (including accounts made before they
    existed) gets the defaults."""
    saved: dict[str, Any] | None = user.get("alerts")
    if not saved:
        return DEFAULT_ALERTS
    quiet: dict[str, Any] = saved.get("quietHours") or {}
    defaults = DEFAULT_ALERTS["quietHours"]
    return {
        "sound": _or(saved.get("sound"), DEFAULT_ALERTS["sound"]),
        "vibration": _or(saved.get("vibration"), DEFAULT_ALERTS["vibration"]),
        "quietHours": {
            "enabled": _or(quiet.get("enabled"), defaults["enabled"]),
            "start": _or(quiet.get("start"), defaults["start"]),
            "end": _or(quiet.get("end"), defaults["end"]),
        },
    }


def meal_reminders_of(user: UserDoc) -> dict[MealType, MealSetting]:
    """Breakfast, lunch and dinner cooking reminders (off, at 07:30, 12:30 and 19:30, until changed)."""
    saved: dict[str, Any] = user.get("mealReminders") or {}

    def read(meal: MealType) -> MealSetting:
        setting: dict[str, Any] = saved.get(meal) or {}
        default = DEFAULT_MEAL_REMINDERS[meal]
        return {
            "enabled": _or(setting.get("enabled"), default["enabled"]),
            "time": _or(setting.get("time"), default["time"]),
        }

    return {"breakfast": read("breakfast"), "lunch": read("lunch"), "dinner": read("dinner")}
