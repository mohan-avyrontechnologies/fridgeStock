"""Favourite foods for one-tap re-adding (server/src/models/Favourite.ts)."""

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
    new_document,
    one_of,
    required,
    validate,
)
from server_py.services import clock
from server_py.shared.enums import STORAGE_LOCATIONS, UNITS
from server_py.shared.js import trim

FAVOURITE: Final = Model(
    "Favourite", "favourites", (index(("userId", 1), ("nameKey", 1), unique=True),), shard_key=("userId",)
)

SCHEMA: Final[Schema] = (
    ("userId", NoDefault),
    ("name", NoDefault),
    # Lower-case name, so "Milk" and "milk" can't both be favourites.
    ("nameKey", NoDefault),
    ("quantity", NoDefault),
    ("unit", NoDefault),
    ("lifespanDays", NoDefault),
    ("storage", "FRIDGE"),
)

RULES: Final[Rules] = {
    "userId": (required(),),
    "name": (required(), length(0, 60)),
    "nameKey": (required(),),
    "quantity": (required(), check(lambda n: n > 0)),
    "unit": (required(), one_of(UNITS)),
    "lifespanDays": (required(), at_least(0), at_most(365)),
    "storage": (required(), one_of(STORAGE_LOCATIONS)),
}


class FavouriteDoc(Document):
    def __init__(self, stored: dict[str, Any]) -> None:
        super().__init__(stored, defaults={"storage": "FRIDGE"})


async def exists(user_id: ObjectId, name_key: str) -> bool:
    return await FAVOURITE.collection().find_one({"userId": user_id, "nameKey": name_key}, {"_id": 1}) is not None


async def create(values: dict[str, Any]) -> FavouriteDoc:
    """Insert a favourite. DuplicateKeyError (code 11000) if the name is taken."""
    prepared = {**values, "name": trim(values["name"])}
    document = new_document(SCHEMA, prepared, now=clock.system_now())
    validate(RULES, document)
    await FAVOURITE.collection().insert_one(document)
    return FavouriteDoc(document)


async def find_owned(favourite_id: ObjectId, user_id: ObjectId) -> FavouriteDoc | None:
    stored = await FAVOURITE.collection().find_one({"_id": favourite_id, "userId": user_id})
    return FavouriteDoc(stored) if stored else None


async def list_for(user_id: ObjectId) -> list[FavouriteDoc]:
    cursor = FAVOURITE.collection().find({"userId": user_id}).sort("nameKey", 1)
    return [FavouriteDoc(stored) async for stored in cursor]


async def delete(favourite_id: ObjectId, user_id: ObjectId) -> None:
    await FAVOURITE.collection().delete_one({"_id": favourite_id, "userId": user_id})
