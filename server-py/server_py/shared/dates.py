"""Calendar-date utilities (shared/src/dates.ts).

Every food date is a "YYYY-MM-DD" string, never a timestamp. Arithmetic works on calendar dates, so
daylight-saving changes and the host machine's time zone can never shift a day.
"""

import re
from datetime import UTC, date, datetime, timedelta
from functools import cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

DateString = str
"""A calendar date in "YYYY-MM-DD" form."""

_PATTERN = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class RangeError(ValueError):
    """JavaScript's RangeError: a value outside what a function accepts, such as an impossible date."""


def _parse(value: str) -> date | None:
    match = _PATTERN.fullmatch(value)
    if not match:
        return None
    year, month, day = (int(group) for group in match.groups())
    # JavaScript's Date.UTC reads years 0-99 as 1900-1999, so the TypeScript check rejects them.
    if year < 100:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _must_parse(value: str) -> date:
    parsed = _parse(value)
    if parsed is None:
        raise RangeError(f'Not a valid "YYYY-MM-DD" date: {value}')
    return parsed


def is_valid_date(value: object) -> bool:
    """True if the value is a real calendar date written as "YYYY-MM-DD"."""
    return isinstance(value, str) and _parse(value) is not None


@cache
def _zones_by_lower_name() -> dict[str, str]:
    return {name.lower(): name for name in available_timezones()}


@cache
def zone(time_zone: str) -> ZoneInfo:
    """An IANA time zone, matched without regard to case as Intl does. RangeError if there is none."""
    try:
        return ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        name = _zones_by_lower_name().get(time_zone.lower())
        if name is None:
            raise RangeError(f"Invalid time zone specified: {time_zone}") from None
        return ZoneInfo(name)


def _local(time_zone: str, now: datetime | None) -> datetime:
    return (now or datetime.now(UTC)).astimezone(zone(time_zone))


def today_in_tz(time_zone: str, now: datetime | None = None) -> DateString:
    """Today's calendar date in an IANA time zone (e.g. "Asia/Kolkata")."""
    return _local(time_zone, now).date().isoformat()


def hour_in_tz(time_zone: str, now: datetime | None = None) -> int:
    """The hour (0-23) it is now in the given IANA time zone."""
    return _local(time_zone, now).hour


def add_days(value: DateString, days: int) -> DateString:
    """The date `days` days after `value` (negative goes back)."""
    return (_must_parse(value) + timedelta(days=days)).isoformat()


def diff_days(start: DateString, end: DateString) -> int:
    """Whole days from `start` to `end`: positive when `end` is later."""
    return (_must_parse(end) - _must_parse(start)).days


def format_display(value: DateString) -> str:
    """A friendly label such as "Thu, 1 Oct". Locale-independent on purpose."""
    parsed = _must_parse(value)
    return f"{_WEEKDAYS[parsed.weekday()]}, {parsed.day} {_MONTHS[parsed.month - 1]}"
