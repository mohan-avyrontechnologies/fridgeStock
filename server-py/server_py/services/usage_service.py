"""Usage history (server/src/services/usageService.ts)."""

from typing import Any

from bson import ObjectId

from server_py.models import usage_record
from server_py.models.food_item import FoodDoc
from server_py.models.usage_record import UsageRecordDoc
from server_py.models.user import UserDoc
from server_py.schemas.food import PaginationInput
from server_py.services import clock
from server_py.services.views import to_usage_view
from server_py.shared.enums import USAGE_ACTIONS, UsageAction
from server_py.shared.js import math_round


def _round2(value: float) -> float:
    return math_round(value * 100) / 100


def _value_of(food: FoodDoc, action: UsageAction, quantity_used: float) -> float | None:
    """The price of the quantity an action covers, or None when the item has no price (or it was removed)."""
    price, price_quantity = food["price"], food["priceQuantity"]
    if action == "REMOVED" or price is None or not price_quantity:
        return None
    return _round2(price * min(quantity_used, price_quantity) / price_quantity)


async def create_record(
    user: UserDoc, food: FoodDoc, action: UsageAction, quantity_used: float, quantity_remaining: float
) -> UsageRecordDoc:
    """Writes one usage record for an action on a food item."""
    return await usage_record.create(
        {
            "userId": user.id,
            "householdId": food["householdId"],
            "foodId": food.id,
            "action": action,
            "date": clock.today(user.time_zone),
            "quantityUsed": quantity_used,
            "foodName": food["name"],
            "unit": food["unit"],
            "quantityRemaining": quantity_remaining,
            "value": _value_of(food, action, quantity_used),
        }
    )


async def latest_for_food(user: UserDoc, food_id: ObjectId) -> UsageRecordDoc | None:
    return await usage_record.latest_for_food(user.household_id, food_id)


async def delete_record(user: UserDoc, record: UsageRecordDoc) -> None:
    await usage_record.delete(record, user.household_id)


async def list_history(user: UserDoc, page: PaginationInput) -> dict[str, Any]:
    """The household's use and waste history, newest first, with per-action totals."""
    records = await usage_record.page(user.household_id, page.limit, page.offset)
    total = await usage_record.count(user.household_id)
    grouped = await usage_record.counts_by_action(user.household_id)
    counts = {action: grouped.get(action, 0) for action in USAGE_ACTIONS}
    return {"items": [to_usage_view(record) for record in records], "total": total, "counts": counts}
