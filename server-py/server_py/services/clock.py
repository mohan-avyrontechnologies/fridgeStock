"""The server's only source of the current time (server/src/services/clock.ts).

Date logic must go through `today(time_zone)`; `now()` is for event timestamps (sentAt, closedAt). Tests pin the
time with `set()` instead of faking timers. `system_now()` ignores that pin: it is the time Mongoose stamps on
createdAt and updatedAt, which the TypeScript server takes from the computer's clock, not from this one.
"""

from datetime import UTC, datetime

from server_py.shared.dates import DateString, today_in_tz

_override: datetime | None = None


def system_now() -> datetime:
    """The computer's time, to the millisecond (all a BSON date keeps)."""
    moment = datetime.now(UTC)
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


def now() -> datetime:
    return _override if _override is not None else system_now()


def today(time_zone: str) -> DateString:
    """Today's calendar date in the given IANA time zone."""
    return today_in_tz(time_zone, now())


def set(moment: datetime | None) -> None:  # noqa: A001 (the TypeScript name)
    global _override
    _override = moment
