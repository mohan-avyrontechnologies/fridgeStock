"""Food items, favourites and history pages (createFoodSchema, updateFoodSchema, bulkCreateSchema,
favouriteSchema, openFoodSchema, moveFoodSchema, useFoodSchema, wasteFoodSchema and paginationSchema in
shared/src/schemas.ts)."""

from typing import Final

from server_py.schemas import zod as z
from server_py.schemas.base import ModelSchema, RequestModel, zod
from server_py.schemas.messages import message
from server_py.schemas.zod import Missing
from server_py.shared.dates import is_valid_date
from server_py.shared.enums import (
    PRINTED_DATE_TYPES,
    STORAGE_LOCATIONS,
    UNITS,
    PrintedDateType,
    StorageLocation,
    Unit,
)

QUANTITY: Final = z.number(message("quantity")).positive(message("quantity")).max(1_000_000, message("quantity"))
NAME: Final = z.string(message("foodName")).trim().min(1, message("foodName")).max(60, message("foodNameTooLong"))
UNIT: Final = z.enum_of(UNITS, message("unit"))
# "Not in the future" depends on the user's time zone, so the service checks that part (with the same message)
# once it knows who is asking.
ADDED_DATE: Final = z.string(message("addedDate")).refine(is_valid_date, message("addedDate"))
LIFESPAN: Final = (
    z.number(message("lifespan")).int(message("lifespan")).min(0, message("lifespan")).max(365, message("lifespan"))
)
NOTES: Final = z.string(message("notes")).trim().max(200, message("notes")).optional()
# Defaults to FRIDGE (or the catalog's usual place) when omitted.
STORAGE: Final = z.enum_of(STORAGE_LOCATIONS, message("storage")).optional()
# When the item was opened, if it has been. Checked against today and the added date by the service.
OPENED_DATE: Final = z.string(message("openedDate")).refine(is_valid_date, message("openedDate")).nullable().optional()
LEFTOVER: Final = z.boolean().optional()
# What the whole quantity cost. Optional; used only for the money saved and lost on Insights.
PRICE: Final = z.number(message("price")).min(0, message("price")).max(100_000, message("price")).nullable().optional()
PRINTED_DATE: Final = (
    z.string(message("printedDate")).refine(is_valid_date, message("printedDate")).nullable().optional()
)
PRINTED_DATE_TYPE: Final = z.enum_of(PRINTED_DATE_TYPES, message("printedDateType")).nullable().optional()
# A free-text category, such as a photo check's, used if the catalog has no entry for the food.
CATEGORY: Final = z.string().trim().max(40).optional()


class CreateFoodInput(RequestModel):
    """The expiry date is not a field: the server always works it out. Unknown keys (such as an expiry date) are
    dropped."""

    name: str = zod(NAME)
    quantity: float = zod(QUANTITY)
    unit: Unit = zod(UNIT)
    # Left out: today (the receipt date for a receipt item) in the person's time zone.
    added_date: str | Missing = zod(ADDED_DATE.optional(), alias="addedDate")
    # Left out: the server estimates the expected expiry. Given: the person set it, and the source is USER.
    lifespan_days: int | Missing = zod(LIFESPAN.optional(), alias="lifespanDays")
    notes: str | Missing = zod(NOTES)
    storage: StorageLocation | Missing = zod(STORAGE)
    opened_date: str | Missing | None = zod(OPENED_DATE, alias="openedDate")
    leftover: bool | Missing = zod(LEFTOVER)
    price: float | Missing | None = zod(PRICE)
    printed_date: str | Missing | None = zod(PRINTED_DATE, alias="printedDate")
    printed_date_type: PrintedDateType | Missing | None = zod(PRINTED_DATE_TYPE, alias="printedDateType")
    category: str | Missing = zod(CATEGORY)


class UpdateFoodInput(RequestModel):
    """Every food field is optional, but at least one must be given."""

    name: str | Missing = zod(NAME.optional())
    quantity: float | Missing = zod(QUANTITY.optional())
    unit: Unit | Missing = zod(UNIT.optional())
    added_date: str | Missing = zod(ADDED_DATE.optional(), alias="addedDate")
    lifespan_days: int | Missing = zod(LIFESPAN.optional(), alias="lifespanDays")
    notes: str | Missing = zod(NOTES)
    storage: StorageLocation | Missing = zod(STORAGE)
    opened_date: str | Missing | None = zod(OPENED_DATE, alias="openedDate")
    leftover: bool | Missing = zod(LEFTOVER)
    price: float | Missing | None = zod(PRICE)

    refinements = ((lambda body: len(body) > 0, "Provide at least one field to update."),)


class BulkItemInput(RequestModel):
    """One row of a bulk add; the added date (and default storage) come from the request."""

    name: str = zod(NAME)
    quantity: float = zod(QUANTITY)
    unit: Unit = zod(UNIT)
    # Left out: estimated by the server. Given: the person set it (source USER).
    lifespan_days: int | Missing = zod(LIFESPAN.optional(), alias="lifespanDays")
    storage: StorageLocation | Missing = zod(STORAGE)
    notes: str | Missing = zod(NOTES)
    price: float | Missing | None = zod(PRICE)
    printed_date: str | Missing | None = zod(PRINTED_DATE, alias="printedDate")
    printed_date_type: PrintedDateType | Missing | None = zod(PRINTED_DATE_TYPE, alias="printedDateType")
    category: str | Missing = zod(CATEGORY)


class BulkCreateInput(RequestModel):
    """A whole shopping haul in one request: 1 to 50 items sharing an added date."""

    added_date: str = zod(ADDED_DATE, alias="addedDate")
    storage: StorageLocation | Missing = zod(STORAGE)
    items: list[BulkItemInput] = zod(
        z.array_of(ModelSchema(BulkItemInput), message("bulkEmpty"))
        .min(1, message("bulkEmpty"))
        .max(50, message("bulkTooMany"))
    )


class FavouriteInput(RequestModel):
    """A saved food the user can re-add with one tap."""

    name: str = zod(NAME)
    quantity: float = zod(QUANTITY)
    unit: Unit = zod(UNIT)
    lifespan_days: int = zod(LIFESPAN, alias="lifespanDays")
    storage: StorageLocation = zod(z.enum_of(STORAGE_LOCATIONS, message("storage")).default("FRIDGE"))


DAYS_LEFT: Final = (
    z.number(message("daysLeft")).int(message("daysLeft")).min(0, message("daysLeft")).max(365, message("daysLeft"))
)


class OpenFoodInput(RequestModel):
    """Mark an item as opened (default: today). `daysLeft` is how long it lasts once opened; left out, the
    server suggests one. The expected expiry only ever gets shorter."""

    opened_date: str | Missing = zod(
        z.string(message("openedDate")).refine(is_valid_date, message("openedDate")).optional(), alias="openedDate"
    )
    days_left: int | Missing = zod(DAYS_LEFT.optional(), alias="daysLeft")


class MoveFoodInput(RequestModel):
    """Move an item to another location; `daysLeft` counts from today (left out: the location's suggestion)."""

    storage: StorageLocation = zod(z.enum_of(STORAGE_LOCATIONS, message("storage")))
    days_left: int | Missing = zod(DAYS_LEFT.optional(), alias="daysLeft")


class UseFoodInput(RequestModel):
    """Leave out `quantity` to use the whole item; a smaller quantity is a partial use."""

    quantity: float | Missing = zod(QUANTITY.optional())


class WasteFoodInput(RequestModel):
    """Wasting always closes the whole item; the body is ignored."""


class PaginationInput(RequestModel):
    """?limit (1 to 100, default 20) and ?offset (default 0), read as JavaScript's Number() reads them."""

    limit: int = zod(z.coerce_number().int().min(1).max(100).default(20))
    offset: int = zod(z.coerce_number().int().min(0).default(0))
