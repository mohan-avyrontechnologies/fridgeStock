"""The food-safety wording check (shared/src/wording.ts), from shared/data/banned-phrases.json.

The app only ever talks about an "expected expiry", an estimate for planning.
"""

import re
from typing import Final

from server_py.shared.data import load

_DATA = load("banned-phrases")

BANNED_PHRASES: Final[tuple[str, ...]] = tuple(_DATA["phrases"])

# \b is ASCII-only in JavaScript, so the pattern is compiled the same way here.
_SAFE_WORD = re.compile(_DATA["safeWordPattern"], re.ASCII)


def has_banned_wording(text: str) -> bool:
    """True if the text uses a banned phrase or calls anything "safe". Used to reject AI output."""
    lower = text.lower()
    return any(phrase in lower for phrase in BANNED_PHRASES) or _SAFE_WORD.search(lower) is not None
