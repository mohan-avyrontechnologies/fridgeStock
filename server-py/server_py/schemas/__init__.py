"""Request schemas: Pydantic models that answer exactly as the shared zod schemas do (shared/src/schemas.ts).

`SCHEMAS` maps each zod schema's name to a function giving the API's answer for a request value, in the form
shared/test-cases/validation.json records. Each phase adds the schemas its routes use and removes them from
`PENDING`; tests/test_shared_cases.py checks every case of every schema listed here.
"""

from collections.abc import Callable
from typing import Any

ValidationAnswer = dict[str, Any]
"""{"valid": True, "data": ...} or {"valid": False, "message": ..., "field": ...}."""

SCHEMAS: dict[str, Callable[[Any], ValidationAnswer]] = {}

# Not ported yet. A phase may not finish while one of its routes' schemas is still listed here.
PENDING: frozenset[str] = frozenset(
    {
        "registerSchema", "loginSchema", "deleteAccountSchema", "joinHouseholdSchema", "inviteCodeParamSchema",
        "updateAccountSchema", "createFoodSchema", "updateFoodSchema", "receiptSchema", "barcodeSchema",
        "bulkCreateSchema", "favouriteSchema", "openFoodSchema", "moveFoodSchema", "useFoodSchema",
        "wasteFoodSchema", "preferencesSchema", "deliverySchema", "pushSubscriptionSchema", "pushUnsubscribeSchema",
        "pushActionSchema", "alertSettingsSchema", "mealRemindersSchema", "recipesRequestSchema", "mealParamSchema",
        "mealDateParamSchema", "mealQuerySchema", "shoppingItemSchema", "shoppingUpdateSchema",
        "mealPlanEntrySchema", "paginationSchema", "notificationPageSchema", "photoCheckSchema",
        "printedDateSchema", "photoSizeSchema",
    }
)  # fmt: skip
