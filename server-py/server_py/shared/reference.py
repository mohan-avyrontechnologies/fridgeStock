"""The Cook First reference list and category defaults (shared/src/foodReference.ts), from shared/data.

Rough planning estimates, in days per storage location (None = not usually kept there). They say nothing
about whether food is fit to eat.
"""

from typing import Final, TypedDict, cast

from server_py.shared.data import load
from server_py.shared.enums import FoodCategory, StorageLocation, Unit
from server_py.shared.js import trim


class ReferenceFood(TypedDict):
    name: str
    unit: Unit
    category: FoodCategory
    lifespanDays: dict[StorageLocation, int | None]
    openedDays: int | None
    """Typical days it lasts once opened (packaged foods only; None when opening makes no difference)."""


class _CategoryWords(TypedDict):
    category: FoodCategory
    words: list[str]


_REFERENCE = load("food-reference")
_CATEGORIES = load("category-defaults")

REFERENCE_SOURCE: Final[str] = _REFERENCE["source"]
FOOD_REFERENCE: Final[tuple[ReferenceFood, ...]] = tuple(cast(list[ReferenceFood], _REFERENCE["foods"]))
CATEGORY_DEFAULTS: Final[dict[FoodCategory, dict[StorageLocation, int | None]]] = _CATEGORIES["defaults"]
_CATEGORY_WORDS: Final[list[_CategoryWords]] = _CATEGORIES["categoryWords"]
_USUALLY_PANTRY: Final[frozenset[str]] = frozenset(_REFERENCE["usuallyPantry"])


def search_reference(query: str, limit: int = 6) -> list[ReferenceFood]:
    """Reference foods whose name contains the query (case-insensitive), best matches first."""
    q = trim(query).lower()
    if not q:
        return []
    found = [food for food in FOOD_REFERENCE if q in food["name"].lower()]
    found.sort(key=lambda food: not food["name"].lower().startswith(q))
    return found[:limit]


def find_reference(name: str) -> ReferenceFood | None:
    """The exact reference entry for a name (case-insensitive), if there is one."""
    key = trim(name).lower()
    return next((food for food in FOOD_REFERENCE if food["name"].lower() == key), None)


def category_from_text(text: str | None) -> FoodCategory | None:
    """The category a free-text label means (case-insensitive), or None when it matches none."""
    lower = trim(text or "").lower()
    if not lower:
        return None
    return next((entry["category"] for entry in _CATEGORY_WORDS if any(word in lower for word in entry["words"])), None)


def usual_storage(food: ReferenceFood) -> StorageLocation:
    """Where a catalog food is usually kept: the pantry for a few shelf foods, else fridge, pantry, freezer."""
    lifespan = food["lifespanDays"]
    if food["name"].lower() in _USUALLY_PANTRY and lifespan["PANTRY"] is not None:
        return "PANTRY"
    if lifespan["FRIDGE"] is not None:
        return "FRIDGE"
    if lifespan["PANTRY"] is not None:
        return "PANTRY"
    return "FREEZER"
