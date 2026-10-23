"""How a reminder should sound (shared/src/alerts.ts). Everything here is pure: the time is always passed in.

Not used, on purpose: full-screen alarms, notifications that ring until dismissed, and iOS critical alerts.
"""

import re
from datetime import datetime
from typing import Any, Final, TypedDict

from server_py.shared.dates import zone
from server_py.shared.enums import MealType, NotificationChannelId, PushKind, ReminderType, SoundName


class QuietHours(TypedDict):
    enabled: bool
    start: str
    end: str


class AlertSettings(TypedDict):
    sound: bool
    vibration: bool
    quietHours: QuietHours


class MealSetting(TypedDict):
    enabled: bool
    time: str


class PushAlert(TypedDict):
    channel: NotificationChannelId
    sound: SoundName | None
    vibrate: list[int]
    requireInteraction: bool
    silent: bool


DEFAULT_ALERTS: Final[AlertSettings] = {
    "sound": True,
    "vibration": True,
    "quietHours": {"enabled": True, "start": "22:00", "end": "07:00"},
}

DEFAULT_MEAL_REMINDERS: Final[dict[MealType, MealSetting]] = {
    "breakfast": {"enabled": False, "time": "07:30"},
    "lunch": {"enabled": False, "time": "12:30"},
    "dinner": {"enabled": False, "time": "19:30"},
}
"""Meal reminders are off until a person turns them on; the times are where they start."""

DIGEST_MERGE_MINUTES: Final = 30
"""A meal reminder and the daily summary closer than this are sent as one."""

MEAL_LABELS: Final[dict[MealType, str]] = {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner"}

_CLOCK = re.compile(r"([01][0-9]|2[0-3]):([0-5][0-9])")


def clock_minutes(time: str) -> int | None:
    """Minutes from midnight for "HH:mm", or None if it isn't a time."""
    match = _CLOCK.fullmatch(time)
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def minutes_in_tz(time_zone: str, now: datetime) -> int:
    """Minutes since midnight it is now in the given IANA time zone."""
    local = now.astimezone(zone(time_zone))
    return local.hour * 60 + local.minute


def is_quiet_hours(time_zone: str, now: datetime, quiet: QuietHours | dict[str, Any]) -> bool:
    """Whether it is quiet hours now. The start is included and the end is not; 22:00 to 07:00 crosses midnight."""
    if not quiet["enabled"]:
        return False
    start = clock_minutes(quiet["start"])
    end = clock_minutes(quiet["end"])
    if start is None or end is None or start == end:
        return False
    minutes = minutes_in_tz(time_zone, now)
    return start <= minutes < end if start < end else minutes >= start or minutes < end


def kind_of_reminder(reminder_type: ReminderType) -> PushKind:
    """The reminder kind for an item reminder type."""
    return reminder_type


def is_urgent(kind: PushKind) -> bool:
    """Due and overdue reminders are the urgent ones."""
    return kind in ("DUE", "OVERDUE")


def sound_for(kind: PushKind) -> SoundName:
    """Gentle for approaching expiry and the summary, strong for due and overdue, and its own for meals."""
    if kind == "MEAL":
        return "meal"
    return "strong" if is_urgent(kind) else "gentle"


def vibration_for(kind: PushKind) -> list[int]:
    """Vibration patterns, in milliseconds (on, off, on...)."""
    if is_urgent(kind):
        return [300, 120, 300, 120, 300]
    return [160, 80, 160] if kind == "MEAL" else [120]


def channel_for(kind: PushKind, sound: bool, vibrate: bool) -> NotificationChannelId:
    """The Android channel: sound and vibration belong to the channel, so each combination needs its own."""
    if is_urgent(kind):
        if sound and vibrate:
            return "food-urgent"
        if sound:
            return "food-urgent-sound"
        return "reminders-vibrate" if vibrate else "reminders-silent"
    if not sound:
        return "reminders-silent"
    return "meal-reminders" if kind == "MEAL" else "food-soon"


def alert_for(kind: PushKind, settings: AlertSettings | dict[str, Any], quiet: bool) -> PushAlert:
    """Sound, vibration, channel and whether it stays on screen. Quiet hours deliver it silently."""
    sound = bool(settings["sound"]) and not quiet
    vibrate = bool(settings["vibration"]) and not quiet
    return {
        "channel": channel_for(kind, sound, vibrate),
        "sound": sound_for(kind) if sound else None,
        "vibrate": vibration_for(kind) if vibrate else [],
        "requireInteraction": is_urgent(kind),
        "silent": not sound and not vibrate,
    }


def merges_with_digest(time: str, digest_hour: int) -> bool:
    """True when a meal reminder at `time` and the summary at `digest_hour` are within 30 minutes."""
    minutes = clock_minutes(time)
    return minutes is not None and abs(minutes - digest_hour * 60) <= DIGEST_MERGE_MINUTES
