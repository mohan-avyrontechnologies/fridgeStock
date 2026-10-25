"""Usage history: what was used, wasted or removed (server/src/models/UsageRecord.ts).

userId isn't in the TDD entity, but every query must be scoped to its owner, so it is stored rather than joined.
Its timestamps come from the app's clock, not the computer's, so "Undo" windows are measured on the same clock
as everything else.
"""

from typing import Any, Final

from bson import ObjectId

from server_py.models.base import Document, Model, NoDefault, Schema, index, new_document
from server_py.services import clock

USAGE_RECORD: Final = Model(
    "UsageRecord",
    "usagerecords",
    (
        index(("householdId", 1)),
        index(("foodId", 1)),
        index(("userId", 1), ("date", -1), ("createdAt", -1)),
        index(("householdId", 1), ("date", -1), ("createdAt", -1)),
    ),
    shard_key=("userId",),
)

SCHEMA: Final[Schema] = (
    # Who did it.
    ("userId", NoDefault),
    # The household that owns the food; history is shared by everyone in it.
    ("householdId", NoDefault),
    ("foodId", NoDefault),
    ("action", NoDefault),
    # The user's calendar day when the action was recorded.
    ("date", NoDefault),
    ("quantityUsed", NoDefault),
    # Snapshots, so history still reads correctly after later edits.
    ("foodName", NoDefault),
    ("unit", NoDefault),
    ("quantityRemaining", NoDefault),
    # The price of quantityUsed when the item had a price, else null.
    ("value", None),
)


class UsageRecordDoc(Document):
    def __init__(self, stored: dict[str, Any]) -> None:
        super().__init__(stored, defaults={"value": None})


async def create(values: dict[str, Any]) -> UsageRecordDoc:
    document = new_document(SCHEMA, values, now=clock.now())
    await USAGE_RECORD.collection().insert_one(document)
    return UsageRecordDoc(document)


async def latest_for_food(household_id: ObjectId, food_id: ObjectId) -> UsageRecordDoc | None:
    """The most recent record for one of the household's items."""
    stored = await USAGE_RECORD.collection().find_one(
        {"householdId": household_id, "foodId": food_id}, sort=[("createdAt", -1), ("_id", -1)]
    )
    return UsageRecordDoc(stored) if stored else None


async def delete(record: UsageRecordDoc, household_id: ObjectId) -> None:
    await USAGE_RECORD.collection().delete_one({"_id": record.id, "householdId": household_id})


async def page(household_id: ObjectId, limit: int, offset: int) -> list[UsageRecordDoc]:
    """One page of the household's history, newest first."""
    cursor = (
        USAGE_RECORD.collection()
        .find({"householdId": household_id})
        .sort([("date", -1), ("createdAt", -1), ("_id", -1)])
        .skip(offset)
        .limit(limit)
    )
    return [UsageRecordDoc(stored) async for stored in cursor]


async def count(household_id: ObjectId) -> int:
    return await USAGE_RECORD.collection().count_documents({"householdId": household_id})


async def counts_by_action(household_id: ObjectId) -> dict[str, int]:
    cursor = await USAGE_RECORD.collection().aggregate(
        [{"$match": {"householdId": household_id}}, {"$group": {"_id": "$action", "count": {"$sum": 1}}}]
    )
    return {group["_id"]: group["count"] async for group in cursor}
