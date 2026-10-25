"""Food items (server/src/models/FoodItem.ts)."""

from server_py.models.base import Model, index

FOOD_ITEM = Model(
    "FoodItem",
    "fooditems",
    (
        index(("userId", 1)),
        index(("householdId", 1)),
        index(("userId", 1), ("status", 1)),
        index(("userId", 1), ("expiryDate", 1)),
    ),
)
