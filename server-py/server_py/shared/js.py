"""JavaScript's text rules, where Python's differ, so the shared logic behaves the same in both languages.

- `String.prototype.trim()` and the regular-expression class `\\s` use one fixed set of whitespace. Python's
  `str.strip()` and `\\s` use `str.isspace()`, which also counts U+001C to U+001F and U+0085 but not U+FEFF.
- `\\d`, `\\w` and `\\b` are ASCII-only in JavaScript and Unicode-aware in Python.
- `String(number)` writes 5.0 as "5" and 1e-7 as "1e-7"; Python writes "5.0" and "1e-07".
- `JSON.parse` refuses NaN and Infinity, and reads every number as a double; `JSON.stringify` writes numbers as
  `String(number)` does and escapes lone surrogates. `text.length` counts UTF-16 code units, not code points.
"""

import json
import math
import re
import unicodedata
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final, cast

# The characters JavaScript's trim() removes and \s matches (WhiteSpace and LineTerminator in ECMA-262),
# written as code points because most of them are invisible.
WHITESPACE = "".join(
    chr(code)
    for code in (
        *range(0x09, 0x0E),  # tab, line feed, vertical tab, form feed, carriage return
        0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
    )
)  # fmt: skip

# A regular-expression class equal to JavaScript's \s.
SPACE = "[" + re.escape(WHITESPACE) + "]"


def trim(text: str) -> str:
    """JavaScript's `text.trim()`."""
    return text.strip(WHITESPACE)


def number_text(value: float) -> str:
    """JavaScript's `String(value)` for a number."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0.0:  # 0 and -0
        return "0"
    if value.is_integer() and abs(value) <= 2**53:
        return str(int(value))
    # repr gives the shortest digits that read back the same, as JavaScript does; only the layout differs.
    # Past 2^53 that is not every digit: JavaScript writes 2^60 as 1152921504606847000.
    text = repr(value)
    if "e" not in text:
        return text.removesuffix(".0")
    mantissa, exponent = text.split("e")
    power = int(exponent)
    if -7 < power < 21:
        # JavaScript writes these out in full: 1e-05 is "0.00001".
        return format(Decimal(text), "f")
    # 1e-07 is "1e-7"; 1e+21 and 1.5e+22 stay as they are.
    return f"{mantissa}e{'-' if power < 0 else '+'}{abs(power)}"


def utf16_length(text: str) -> int:
    """JavaScript's `text.length`: UTF-16 code units, so "😀" counts 2."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def utf16_slice(text: str, end: int) -> str:
    """`text.slice(0, end)`, counted in UTF-16 units: it can cut an emoji in half, leaving a lone surrogate."""
    return text.encode("utf-16-le", "surrogatepass")[: end * 2].decode("utf-16-le", "surrogatepass")


# A lone surrogate: Python keeps one in a str (from a JSON "\ud800" escape, say) where JavaScript would too.
_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


def utf8(text: str) -> bytes:
    """`Buffer.from(text)`: UTF-8, with any lone surrogate written as U+FFFD as Node does."""
    return _LONE_SURROGATE.sub(chr(0xFFFD), text).encode("utf-8")


class _JsonNumberError(ValueError):
    pass


def _reject_constant(name: str) -> object:
    raise _JsonNumberError(f"{name} is not JSON")


def _parse_int(text: str) -> int | float:
    # Every JavaScript number is a double, so integers past 2^53 lose precision there; keep them as floats too.
    value = int(text)
    return value if abs(value) <= 2**53 else float(text)


_DECODER = json.JSONDecoder(parse_int=_parse_int, parse_constant=_reject_constant)


def json_parse(text: str) -> object:
    """`JSON.parse(text)`. ValueError when it isn't JSON (Python alone would accept NaN and Infinity)."""
    return _DECODER.decode(text)


def _string_text(text: str) -> str:
    # json.dumps escapes the same characters JSON.stringify does; it leaves lone surrogates alone, which
    # JavaScript escapes.
    return _LONE_SURROGATE.sub(
        lambda match: chr(92) + f"u{ord(match.group()):04x}", json.dumps(text, ensure_ascii=False)
    )


def json_stringify(value: object) -> str:
    """`JSON.stringify(value)` for JSON-shaped values: no spaces, non-ASCII kept, numbers as JavaScript writes them
    (5, not 5.0; null for NaN and Infinity) and lone surrogates escaped."""
    if value is None or value is True or value is False:
        return "null" if value is None else "true" if value else "false"
    if isinstance(value, str):
        return _string_text(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return number_text(value) if math.isfinite(value) else "null"
    if isinstance(value, dict):
        items = cast(dict[object, object], value).items()
        return "{" + ",".join(f"{_string_text(str(key))}:{json_stringify(item)}" for key, item in items) + "}"
    if isinstance(value, list | tuple):
        return "[" + ",".join(json_stringify(item) for item in cast(list[object], value)) + "]"
    raise TypeError(f"{type(value).__name__} is not JSON-shaped")


def iso_string(moment: datetime) -> str:
    """`date.toISOString()`: UTC, always with milliseconds, like 2026-09-29T12:00:00.000Z."""
    utc = moment.astimezone(UTC) if moment.tzinfo else moment.replace(tzinfo=UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def math_round(value: float) -> int | float:
    """`Math.round(value)`: halves go up (2.5 is 3, -2.5 is -2), where Python's round() goes to even."""
    if not math.isfinite(value):
        return value
    floor = math.floor(value)
    return floor + 1 if value - floor >= 0.5 else floor


# The order ICU's root collation (String.prototype.localeCompare) gives the ASCII marks, before digits and
# letters. Recorded from Node.
_MARKS: Final = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"
# Letters that sort as others with an accent-level difference (o with a stroke as o), or as two
# letters (the joined ae as ae).
_FOLDED: Final = {"\u00df": "ss", "\u00e6": "ae", "\u0153": "oe", "\u00f8": "o", "\u0111": "d", "\u0142": "l"}


def _collation_parts(char: str) -> tuple[str, bool]:
    """The base letters a character sorts as, and whether it carries an accent (a secondary difference)."""
    lower = char.lower()
    if lower in _FOLDED:
        return _FOLDED[lower], True
    decomposed = unicodedata.normalize("NFKD", lower)
    base = "".join(c for c in decomposed if not unicodedata.combining(c))
    return base or lower, base != lower


def _primary(char: str) -> tuple[int, int]:
    if char in _MARKS:
        return (0, _MARKS.index(char))
    if char.isdigit() and char.isascii():
        return (1, ord(char))
    if char.isalpha():
        return (2, ord(char))
    return (0, len(_MARKS) + ord(char))


def locale_compare_key(text: str) -> tuple[tuple[tuple[int, int], ...], tuple[bool, ...], tuple[bool, ...]]:
    """A sort key that orders text as `a.localeCompare(b)` does for the names people type: letters by their base
    letter first (case and accents ignored), then accents, then lower case before upper case. Marks come before
    digits, digits before letters."""
    primary: list[tuple[int, int]] = []
    secondary: list[bool] = []
    tertiary: list[bool] = []
    for char in text:
        base, accented = _collation_parts(char)
        primary.extend(_primary(c) for c in base)
        secondary.append(accented)
        tertiary.append(char != char.lower())
    return tuple(primary), tuple(secondary), tuple(tertiary)
