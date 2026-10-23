"""Deterministic priority engine (TDD §6; server/src/services/priorityEngine.ts).

A pure function: no database, no web framework, no clock. The same items and the same `today` always give the
same result. Urgency is calculated here on every read and never stored.
"""

from collections.abc import Mapping, Sequence
from typing import Any, TypedDict

from server_py.config.urgency import APPROACHING_EXPIRY_DAYS
from server_py.shared.dates import DateString, diff_days
from server_py.shared.enums import Urgency

_COOK_FIRST: frozenset[Urgency] = frozenset({"APPROACHING_EXPIRY", "DUE", "OVERDUE"})


class Prioritisation(TypedDict):
    items: list[dict[str, Any]]
    """Every ACTIVE item, most urgent first, each with remainingDays and urgency added."""
    cookFirst: list[dict[str, Any]]
    """The items that are APPROACHING_EXPIRY, DUE or OVERDUE, in the same order."""
    summary: dict[str, int]
    """How many items are in each urgency state, plus the total."""


def classify_urgency(remaining_days: int) -> Urgency:
    """remaining_days = expiry date - today."""
    if remaining_days < 0:
        return "OVERDUE"
    if remaining_days == 0:
        return "DUE"
    if remaining_days <= APPROACHING_EXPIRY_DAYS:
        return "APPROACHING_EXPIRY"
    return "NOT_URGENT"


def priority_key(item: Mapping[str, Any]) -> tuple[str, str, str]:
    """Expiry date, then added date, then id (as strings). "YYYY-MM-DD" strings sort chronologically."""
    return (item["expiryDate"], item["addedDate"], item["id"])


def prioritise(items: Sequence[Mapping[str, Any]], today: DateString) -> Prioritisation:
    ranked: list[dict[str, Any]] = []
    for item in items:
        if item["status"] != "ACTIVE":
            continue
        remaining = diff_days(today, item["expiryDate"])
        ranked.append({**item, "remainingDays": remaining, "urgency": classify_urgency(remaining)})
    ranked.sort(key=priority_key)

    summary = {"NOT_URGENT": 0, "APPROACHING_EXPIRY": 0, "DUE": 0, "OVERDUE": 0, "total": len(ranked)}
    for item in ranked:
        summary[item["urgency"]] += 1
    cook_first = [item for item in ranked if item["urgency"] in _COOK_FIRST]
    return {"items": ranked, "cookFirst": cook_first, "summary": summary}
