"""Request schemas: Pydantic models that answer exactly as the shared zod schemas do (shared/src/schemas.ts).

`SCHEMAS` maps each zod schema's name to a function giving the API's answer for a request value, in the form
shared/test-cases/validation.json records. Each phase adds the schemas its routes use and removes them from
`PENDING`; tests/test_shared_cases.py checks every case of every schema listed here.
"""

from collections.abc import Callable
from typing import Any

from server_py.schemas.auth import LoginInput, RegisterInput, UpdateAccountInput
from server_py.schemas.base import RequestModel
from server_py.schemas.food import (
    BulkCreateInput,
    CreateFoodInput,
    FavouriteInput,
    MoveFoodInput,
    OpenFoodInput,
    PaginationInput,
    UpdateFoodInput,
    UseFoodInput,
    WasteFoodInput,
)
from server_py.schemas.zod import ZodIssue

ValidationAnswer = dict[str, Any]
"""{"valid": True, "data": ...} or {"valid": False, "message": ..., "field": ...}."""


def answer(model: type[RequestModel]) -> Callable[[Any], ValidationAnswer]:
    def check(value: Any) -> ValidationAnswer:
        try:
            return {"valid": True, "data": model.parse_input(value).data()}
        except ZodIssue as issue:
            return {"valid": False, "message": issue.message, "field": issue.field}

    return check


SCHEMAS: dict[str, Callable[[Any], ValidationAnswer]] = {
    "registerSchema": answer(RegisterInput),
    "loginSchema": answer(LoginInput),
    "updateAccountSchema": answer(UpdateAccountInput),
    "createFoodSchema": answer(CreateFoodInput),
    "updateFoodSchema": answer(UpdateFoodInput),
    "bulkCreateSchema": answer(BulkCreateInput),
    "favouriteSchema": answer(FavouriteInput),
    "openFoodSchema": answer(OpenFoodInput),
    "moveFoodSchema": answer(MoveFoodInput),
    "useFoodSchema": answer(UseFoodInput),
    "wasteFoodSchema": answer(WasteFoodInput),
    "paginationSchema": answer(PaginationInput),
}

# Not ported yet. A phase may not finish while one of its routes' schemas is still listed here.
PENDING: frozenset[str] = frozenset(
    {
        "deleteAccountSchema", "joinHouseholdSchema", "inviteCodeParamSchema", "receiptSchema", "barcodeSchema",
        "preferencesSchema", "deliverySchema", "pushSubscriptionSchema", "pushUnsubscribeSchema",
        "pushActionSchema", "alertSettingsSchema", "mealRemindersSchema", "recipesRequestSchema", "mealParamSchema",
        "mealDateParamSchema", "mealQuerySchema", "shoppingItemSchema", "shoppingUpdateSchema",
        "mealPlanEntrySchema", "notificationPageSchema", "photoCheckSchema", "printedDateSchema", "photoSizeSchema",
    }
)  # fmt: skip
