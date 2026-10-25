"""Lifespans learned from what a person usually enters (server/src/services/suggestionService.ts)."""

from typing import Final

from server_py.models import food_item
from server_py.models.user import UserDoc
from server_py.shared.estimate import LearnedLifespan
from server_py.shared.js import locale_compare_key, math_round, trim

# How many of the most recent items per food and location to learn from.
RECENT: Final = 10
# A suggestion needs at least this many items behind it.
MIN_ITEMS: Final = 2


def _median(values: list[int]) -> int:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return int(math_round((ordered[middle - 1] + ordered[middle]) / 2))


async def learned_lifespans(user: UserDoc) -> list[LearnedLifespan]:
    """The lifespans this user usually sets, per food name (ignoring case) and location: the median of what they
    entered for their last 10 such items, once there are at least 2. Uses what they entered, not what Move or
    Opened changed it to, and only their own items."""
    groups: dict[str, LearnedLifespan] = {}
    days: dict[str, list[int]] = {}
    for item in await food_item.find_entered_by(user.id):
        key = f"{trim(item['name']).lower()}|{item['enteredStorage']}"
        if key not in groups:
            groups[key] = {
                "name": item["name"],
                "storage": item["enteredStorage"],
                "unit": item["unit"],
                "days": 0,
                "basedOn": 0,
            }
            days[key] = []
        if len(days[key]) < RECENT:
            days[key].append(item["enteredLifespanDays"])
    learned: list[LearnedLifespan] = [
        {**groups[key], "days": _median(values), "basedOn": len(values)}
        for key, values in days.items()
        if len(values) >= MIN_ITEMS
    ]
    learned.sort(key=lambda entry: (locale_compare_key(entry["name"]), locale_compare_key(entry["storage"])))
    return learned
