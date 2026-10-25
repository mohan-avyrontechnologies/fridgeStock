"""The shopping list (server/src/models/ShoppingItem.ts)."""

from server_py.models.base import Model, index

SHOPPING_ITEM = Model(
    "ShoppingItem",
    "shoppingitems",
    (index(("householdId", 1)), index(("householdId", 1), ("checked", 1), ("createdAt", 1))),
)
