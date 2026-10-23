"""The sentences estimate_expiry returns (shared/src/estimateCopy.ts), from shared/data/estimate-copy.json.

Every sentence says "expected expiry" and none says whether food is fit to eat.
"""

from typing import Final

from server_py.shared.data import load
from server_py.shared.enums import PrintedDateType, StorageLocation
from server_py.shared.template import fill_template

_COPY = load("estimate-copy")

USER_EXPLANATION: Final[str] = _COPY["userExplanation"]
"""The explanation for an expected expiry the person set themselves."""


def _days(days: int) -> str:
    return fill_template(_COPY["days"]["one"] if days == 1 else _COPY["days"]["other"], {"n": days})


def _place(storage: StorageLocation) -> str:
    return storage.lower()


def printed(printed_type: PrintedDateType) -> str:
    return fill_template(_COPY["printed"], {"printed": _COPY["printedWords"][printed_type]})


def learned(name: str, days: int, storage: StorageLocation) -> str:
    return fill_template(_COPY["learned"], {"name": name.lower(), "days": _days(days), "storage": _place(storage)})


def catalog(name: str, days: int, storage: StorageLocation) -> str:
    return fill_template(_COPY["catalog"], {"name": name.lower(), "days": _days(days), "storage": _place(storage)})


def catalog_opened(name: str, days: int) -> str:
    return fill_template(_COPY["catalogOpened"], {"name": name.lower(), "days": _days(days)})


def category(days: int, storage: StorageLocation) -> str:
    return fill_template(_COPY["category"], {"days": _days(days), "storage": _place(storage)})


def fallback(days: int) -> str:
    return fill_template(_COPY["fallback"], {"days": _days(days)})
