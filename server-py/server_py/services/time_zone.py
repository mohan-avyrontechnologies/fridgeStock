"""Time zone names (server/src/services/timeZone.ts)."""

from server_py.shared.dates import RangeError, zone


def is_valid_time_zone(time_zone: str) -> bool:
    """True if the string is a time zone Intl recognises, e.g. "Asia/Kolkata", "asia/kolkata" or "+05:30"."""
    try:
        zone(time_zone)
    except RangeError:
        return False
    return True
