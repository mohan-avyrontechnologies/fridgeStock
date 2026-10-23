"""Product barcodes (GTIN): EAN-8, UPC-A, EAN-13 and GTIN-14, each ending in a check digit (shared/src/barcode.ts)."""

import re

from server_py.shared.js import SPACE

BARCODE_LENGTHS = (8, 12, 13, 14)

_DIGITS = re.compile(r"[0-9]+")
_SPACES_AND_DASHES = re.compile(f"{SPACE}|-")


def is_valid_barcode(code: str) -> bool:
    """True for 8, 12, 13 or 14 digits whose last digit is the correct check digit."""
    if not _DIGITS.fullmatch(code) or len(code) not in BARCODE_LENGTHS:
        return False
    digits = [int(digit) for digit in code]
    check = digits.pop()
    # From the right, the digit next to the check digit counts three times, then once, and so on.
    total = sum(digit * (3 if i % 2 == 0 else 1) for i, digit in enumerate(reversed(digits)))
    return (10 - total % 10) % 10 == check


def clean_barcode(text: str) -> str:
    """What people type or scan, tidied: spaces and dashes are dropped."""
    return _SPACES_AND_DASHES.sub("", text)
