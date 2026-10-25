"""Food items (server/src/models/FoodItem.ts).

Only the lifecycle status is stored. Urgency is worked out every time items are read. A partly used item stays
ACTIVE while quantity remains. Food dates are "YYYY-MM-DD" strings, never timestamps; expiryDate is always
addedDate + lifespanDays, worked out in services/food_service.py, never by the model.
"""

from typing import Any, Final

from bson import ObjectId

from server_py.models.base import (
    Document,
    Model,
    NoDefault,
    Rules,
    Schema,
    at_least,
    at_most,
    check,
    index,
    length,
    modified_paths,
    new_document,
    one_of,
    required,
    save,
    validate,
)
from server_py.services import clock
from server_py.shared.dates import is_valid_date
from server_py.shared.enums import EXPIRY_SOURCES, FOOD_STATUSES, PRINTED_DATE_TYPES, STORAGE_LOCATIONS, UNITS
from server_py.shared.js import trim

FOOD_ITEM: Final = Model(
    "FoodItem",
    "fooditems",
    (
        index(("userId", 1)),
        index(("householdId", 1)),
        index(("userId", 1), ("status", 1)),
        index(("userId", 1), ("expiryDate", 1)),
    ),
    # shardKey adds userId to the filter of every save.
    shard_key=("userId",),
)

# The schema's fields in order, with their defaults (the order Mongoose writes a new item in).
SCHEMA: Final[Schema] = (
    ("userId", NoDefault),
    ("householdId", NoDefault),
    ("name", NoDefault),
    ("quantity", NoDefault),
    ("unit", NoDefault),
    ("addedDate", NoDefault),
    ("lifespanDays", NoDefault),
    ("expiryDate", NoDefault),
    # Where expiryDate came from. Items from before v2.23 count as USER.
    ("expirySource", "USER"),
    # One short sentence saying why the expected expiry is what it is. Empty for items from before v2.23.
    ("estimateExplanation", ""),
    # A date read off the pack, if one was found, and what it was called.
    ("printedDate", None),
    ("printedDateType", None),
    # The source and explanation before "Opened" changed them, so opening can be undone.
    ("sourceBeforeOpened", None),
    ("explanationBeforeOpened", None),
    ("notes", NoDefault),
    ("storage", "FRIDGE"),
    ("openedDate", None),
    # The lifespan before "Opened" shortened it.
    ("lifespanBeforeOpened", None),
    # Snoozed from a push notification: left out of push reminders until this day.
    ("snoozedUntil", None),
    # Leftovers from a cooked meal (short lifespan).
    ("leftover", False),
    # What priceQuantity of this item cost; used only for money saved and lost on Insights.
    ("price", None),
    # When the item's photo was last set. The photo itself is in GridFS.
    ("photoAt", None),
    ("priceQuantity", None),
    # What the person chose when adding or editing (not changed by Move or Opened), to learn usual lifespans.
    ("enteredLifespanDays", NoDefault),
    ("enteredStorage", NoDefault),
    # False when the app estimated the lifespan: only lifespans people typed are learned from.
    ("enteredByUser", True),
    ("status", "ACTIVE"),
    ("closedAt", NoDefault),
)

DEFAULTS: Final = {name: default for name, default in SCHEMA if default is not NoDefault}

_CALENDAR_DATE: Final = 'Must be a "YYYY-MM-DD" calendar date.'

RULES: Final[Rules] = {
    "userId": (required(),),
    "householdId": (required(),),
    "name": (required(), length(1, 60)),
    "quantity": (required(), check(lambda n: n > 0, "Quantity must be greater than zero.")),
    "unit": (required(), one_of(UNITS)),
    "addedDate": (required(), check(is_valid_date, _CALENDAR_DATE)),
    "lifespanDays": (
        required(),
        at_least(0),
        at_most(365),
        check(lambda n: float(n).is_integer(), "Lifespan must be a whole number of days."),
    ),
    "expiryDate": (required(), check(is_valid_date, _CALENDAR_DATE)),
    "expirySource": (one_of(EXPIRY_SOURCES), required()),
    "estimateExplanation": (length(0, 240),),
    "printedDate": (check(is_valid_date, _CALENDAR_DATE),),
    "printedDateType": (one_of(PRINTED_DATE_TYPES),),
    "sourceBeforeOpened": (one_of(EXPIRY_SOURCES),),
    "notes": (length(0, 200),),
    "storage": (one_of(STORAGE_LOCATIONS), required()),
    "openedDate": (check(is_valid_date, _CALENDAR_DATE),),
    "price": (at_least(0), at_most(100_000)),
    "priceQuantity": (at_least(0),),
    "enteredLifespanDays": (required(), at_least(0), at_most(365)),
    "enteredStorage": (one_of(STORAGE_LOCATIONS), required()),
    "status": (one_of(FOOD_STATUSES), required()),
}


class FoodDoc(Document):
    """A food item as Mongoose hydrates one: every default filled in."""

    def __init__(self, stored: dict[str, Any]) -> None:
        super().__init__(stored, defaults=DEFAULTS)

    def set(self, path: str, value: object) -> None:
        # The schema trims these two.
        super().set(path, trim(value) if path in ("name", "notes") and isinstance(value, str) else value)


def _prepared(values: dict[str, Any]) -> dict[str, Any]:
    trimmed = dict(values)
    for name in ("name", "notes"):
        if isinstance(trimmed.get(name), str):
            trimmed[name] = trim(trimmed[name])
    return trimmed


def check_new(values: dict[str, Any]) -> None:
    """Mongoose's validation of a new item, without saving it (`new FoodItemModel(values).validate()`)."""
    validate(RULES, _prepared(values))


async def create(values: dict[str, Any]) -> FoodDoc:
    """`FoodItemModel.create(values)`. DocumentValidationError if the schema refuses it."""
    document = new_document(SCHEMA, _prepared(values), now=clock.system_now())
    validate(RULES, document)
    await FOOD_ITEM.collection().insert_one(document)
    return FoodDoc(document)


async def insert_many(rows: list[dict[str, Any]]) -> list[FoodDoc]:
    """`FoodItemModel.insertMany(rows)`: every row is checked first, and nothing is saved if one is refused."""
    now = clock.system_now()
    documents = [new_document(SCHEMA, _prepared(row), now=now, insert_many=True) for row in rows]
    for document in documents:
        validate(RULES, document)
    if documents:
        await FOOD_ITEM.collection().insert_many(documents)
    return [FoodDoc(document) for document in documents]


async def save_food(food: FoodDoc) -> None:
    """`food.save()`: the changed paths are checked, then written."""
    validate(RULES, food.data, modified_paths(food))
    await save(FOOD_ITEM, food)


async def find_in_household(food_id: ObjectId, household_id: ObjectId) -> FoodDoc | None:
    stored = await FOOD_ITEM.collection().find_one({"_id": food_id, "householdId": household_id})
    return FoodDoc(stored) if stored else None


async def find_active(household_id: ObjectId) -> list[FoodDoc]:
    cursor = FOOD_ITEM.collection().find({"householdId": household_id, "status": "ACTIVE"})
    return [FoodDoc(stored) async for stored in cursor]


async def find_entered_by(user_id: ObjectId) -> list[dict[str, Any]]:
    """The user's own items with a lifespan they typed in, newest first (what learned lifespans read)."""
    cursor = (
        FOOD_ITEM.collection()
        .find(
            # Only lifespans the person typed in: estimates would just teach the app its own numbers back.
            {"userId": user_id, "enteredByUser": {"$ne": False}},
            {"name": 1, "unit": 1, "enteredLifespanDays": 1, "enteredStorage": 1, "createdAt": 1},
        )
        .sort([("createdAt", -1), ("_id", -1)])
    )
    return [stored async for stored in cursor]
