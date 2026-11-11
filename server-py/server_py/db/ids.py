"""Primary keys: UUIDv7 (RFC 9562), made by the app and returned in the API as lower-case strings.

Several lists break ties by id (history, the feed, the shopping list, learned lifespans, members, the export), as
Node does with ObjectIds, which follow insertion order even within one millisecond. So these do too: the first 48
bits are the Unix time in milliseconds, and the next 12 (`rand_a`) are a counter within the millisecond (RFC 9562,
§6.2, method 1), started at a random value in its lower half so there's room to count up. If the counter runs out,
or the system clock steps back, the id borrows the next millisecond, so every id this process makes is larger than
the one before. Python 3.12 has no `uuid7()`, and PostgreSQL's `uuidv7()` only exists from version 18.

Ids follow the real time, not services/clock.py: like an ObjectId, an id records when the row was made, and tests
that fix the app's clock still need ids that sort in creation order.
"""

import re
import secrets
import threading
import time
from uuid import UUID

_COUNTER_MAX = 0xFFF
_lock = threading.Lock()
_last_ms = -1
_counter = 0

UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
"""Matched whole (`fullmatch`): Python's `$` also matches before a final newline, which JavaScript's doesn't."""


def new_id() -> UUID:
    """The next id: larger than any this process has made before."""
    global _last_ms, _counter
    with _lock:
        now_ms = time.time_ns() // 1_000_000
        if now_ms > _last_ms:
            _last_ms, _counter = now_ms, secrets.randbelow(_COUNTER_MAX // 2 + 1)
        elif _counter < _COUNTER_MAX:
            _counter += 1
        else:
            _last_ms, _counter = _last_ms + 1, 0
        ms, counter = _last_ms, _counter
    rand_b = secrets.randbits(62)
    value = (ms & 0xFFFF_FFFF_FFFF) << 80 | 0x7 << 76 | counter << 64 | 0b10 << 62 | rand_b
    return UUID(int=value)


def parse_id(text: str) -> UUID | None:
    """The id in a path or body, or None for anything that isn't a UUID (which callers answer as "not found",
    as Node does for a string that isn't an ObjectId, so a bad id never reaches the database as a cast error)."""
    return UUID(text) if UUID_PATTERN.fullmatch(text) else None
