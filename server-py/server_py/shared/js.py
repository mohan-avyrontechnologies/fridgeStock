"""JavaScript's text rules, where Python's differ, so the shared logic behaves the same in both languages.

- `String.prototype.trim()` and the regular-expression class `\\s` use one fixed set of whitespace. Python's
  `str.strip()` and `\\s` use `str.isspace()`, which also counts U+001C to U+001F and U+0085 but not U+FEFF.
- `\\d`, `\\w` and `\\b` are ASCII-only in JavaScript and Unicode-aware in Python.
- `String(number)` writes 5.0 as "5" and 1e-7 as "1e-7"; Python writes "5.0" and "1e-07".
"""

import math
import re
from decimal import Decimal

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
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    # repr gives the shortest digits that read back the same, as JavaScript does; only the layout differs.
    text = repr(value)
    if "e" not in text:
        return text
    mantissa, exponent = text.split("e")
    power = int(exponent)
    if -7 < power < 21:
        # JavaScript writes these out in full: 1e-05 is "0.00001".
        return format(Decimal(text), "f")
    # 1e-07 is "1e-7"; 1e+21 and 1.5e+22 stay as they are.
    return f"{mantissa}e{'-' if power < 0 else '+'}{abs(power)}"
