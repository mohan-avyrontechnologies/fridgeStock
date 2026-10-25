"""Start-up data migrations (server/src/models/migrations.ts), step for step. Every step is safe to run again:
each update only matches documents that still need it."""

import logging
from typing import Any

from pymongo.errors import OperationFailure

from server_py.models import ALL_MODELS
from server_py.models.base import Model, ensure_indexes, new_id, sync_indexes
from server_py.models.favourite import FAVOURITE
from server_py.models.food_item import FOOD_ITEM
from server_py.models.meal_plan_entry import MEAL_PLAN_ENTRY
from server_py.models.meal_reminder_log import MEAL_REMINDER_LOG
from server_py.models.notification import NOTIFICATION
from server_py.models.recipe_idea_cache import RECIPE_IDEA_CACHE
from server_py.models.shopping_item import SHOPPING_ITEM
from server_py.models.usage_record import USAGE_RECORD
from server_py.models.user import USER

log = logging.getLogger(__name__)


async def _dates_to_strings(model: Model, fields: list[str]) -> None:
    """Data written before v2.0 stored food dates as BSON dates at UTC midnight. Rewrite any that remain as
    "YYYY-MM-DD" strings."""
    for name in fields:
        await model.collection().update_many(
            {name: {"$type": "date"}},
            [{"$set": {name: {"$dateToString": {"format": "%Y-%m-%d", "date": f"${name}", "timezone": "UTC"}}}}],
        )


async def _copy_household(model: Model) -> None:
    """Give a collection's documents that have no household the household of the user who made them."""
    collection = model.collection()
    for user_id in await collection.distinct("userId", {"householdId": {"$exists": False}}):
        user: dict[str, Any] | None = await USER.collection().find_one({"_id": user_id})
        if user:
            await collection.update_many(
                {"userId": user_id, "householdId": {"$exists": False}}, {"$set": {"householdId": user["householdId"]}}
            )


async def _backfill_household_and_storage() -> None:
    """v2.5 added householdId, storage and openedDate. Give existing users their own household, copy it onto
    their food items, and default storage to FRIDGE."""
    async for user in USER.collection().find({"householdId": {"$exists": False}}):
        await USER.collection().update_one({"_id": user["_id"]}, {"$set": {"householdId": new_id()}})
    await _copy_household(FOOD_ITEM)
    foods = FOOD_ITEM.collection()
    await foods.update_many({"storage": {"$exists": False}}, {"$set": {"storage": "FRIDGE"}})
    await foods.update_many({"openedDate": {"$exists": False}}, {"$set": {"openedDate": None}})
    # v2.6: what the user entered, used to learn their usual lifespans.
    await foods.update_many(
        {"enteredLifespanDays": {"$exists": False}},
        [{"$set": {"enteredLifespanDays": "$lifespanDays", "enteredStorage": "$storage"}}],
    )


async def _backfill_shared_households() -> None:
    """v2.11 shares usage history, the shopping list and the meal plan within a household."""
    for model in (USAGE_RECORD, SHOPPING_ITEM, MEAL_PLAN_ENTRY):
        await _copy_household(model)


async def ensure_all_indexes() -> None:
    """Mongoose's autoIndex: every model's collection and indexes exist once the server has started. An index
    that clashes with one already there is logged, not fatal, as Mongoose only reports it."""
    for model in ALL_MODELS:
        try:
            await ensure_indexes(model)
        except OperationFailure as error:
            log.warning("Could not create the %s indexes: %s", model.name, error)


async def run_migrations() -> None:
    await _backfill_household_and_storage()
    await _backfill_shared_households()
    # v2.17 added a meal to each plan entry: the ones made before it were all dinners.
    await MEAL_PLAN_ENTRY.collection().update_many({"meal": {"$exists": False}}, {"$set": {"meal": "dinner"}})
    await _dates_to_strings(FOOD_ITEM, ["addedDate", "expiryDate"])
    await _dates_to_strings(NOTIFICATION, ["expiryDate", "scheduledDate"])
    await _dates_to_strings(USAGE_RECORD, ["date"])
    # Drops indexes no longer in the models (e.g. the pre-v1.3 reminder index).
    for model in (
        FOOD_ITEM,
        NOTIFICATION,
        USAGE_RECORD,
        SHOPPING_ITEM,
        MEAL_PLAN_ENTRY,
        USER,
        FAVOURITE,
        MEAL_REMINDER_LOG,
        RECIPE_IDEA_CACHE,
    ):
        await sync_indexes(model)
