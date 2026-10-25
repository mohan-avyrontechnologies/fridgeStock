"""Food items: adding, editing, using, wasting, opening, moving and undoing (server/src/services/foodService.ts).

Every lookup is filtered by the household, so another household's item is indistinguishable from a missing one
(404 rather than 403, so ids don't leak). The expiry date is always worked out here, never taken from the client.
"""

import logging
from datetime import timedelta
from typing import Any, Final, Literal

from bson import ObjectId

from server_py import messages
from server_py.models import food_item
from server_py.models.food_item import FoodDoc
from server_py.models.user import UserDoc
from server_py.schemas.food import (
    BulkCreateInput,
    CreateFoodInput,
    MoveFoodInput,
    OpenFoodInput,
    UpdateFoodInput,
    UseFoodInput,
)
from server_py.schemas.messages import message
from server_py.services import clock, usage_service
from server_py.services.errors import conflict, food_not_found, validation_error
from server_py.services.notification_service import cancel_for_food, dispatch_due, schedule_for_household
from server_py.services.priority_engine import prioritise
from server_py.services.suggestion_service import learned_lifespans
from server_py.services.views import to_food_view, to_usage_view
from server_py.shared.dates import DateString, add_days, diff_days
from server_py.shared.estimate import (
    EstimateInput,
    ExpiryEstimate,
    LearnedLifespan,
    estimate_expiry,
    is_usable_printed_date,
    lifespan_for,
    recalculate_expiry,
)
from server_py.shared.estimate_copy import USER_EXPLANATION
from server_py.shared.js import math_round, number_text, trim
from server_py.shared.reference import find_reference, usual_storage

log = logging.getLogger(__name__)

# How long after an action its "Undo" still works.
UNDO_WINDOW: Final = timedelta(minutes=10)
# Leftovers kept anywhere but the freezer can have a lifespan of at most this many days.
LEFTOVER_MAX_DAYS: Final = 4
# The longest lifespan an item can have.
MAX_LIFESPAN: Final = 365
# How long "Snooze" on a push notification keeps an item out of push reminders.
SNOOZE_DAYS: Final = 1


def _round(value: float) -> float:
    """Avoids 0.30000000000000004-style leftovers after subtracting decimals."""
    return math_round(value * 1000) / 1000


def _object_id(value: str) -> ObjectId | None:
    """The id, or None when it isn't one (Mongoose's isValidObjectId: 24 hexadecimal digits)."""
    return ObjectId(value) if len(value) == 24 and ObjectId.is_valid(value) else None


async def _find_owned(user: UserDoc, food_id: str) -> FoodDoc:
    object_id = _object_id(food_id)
    food = await food_item.find_in_household(object_id, user.household_id) if object_id else None
    if food is None:
        raise food_not_found()
    return food


def _assert_active(food: FoodDoc) -> None:
    """Any action on a used, wasted or removed item is a 409."""
    if food["status"] != "ACTIVE":
        raise conflict(message("itemClosed"))


def _assert_not_future(added_date: DateString, today: DateString) -> None:
    """Past dates are fine (food bought earlier); a date after today in the user's time zone is not."""
    if added_date > today:
        raise validation_error(message("addedDate"), "addedDate")


def _assert_opened_date(opened_date: DateString | None, added_date: DateString, today: DateString) -> None:
    """An opened date can't be in the future or before the item was added."""
    if opened_date and (opened_date > today or opened_date < added_date):
        raise validation_error(message("openedDate"), "openedDate")


def _assert_leftover_lifespan(leftover: bool, storage: str, lifespan_days: int, field: str = "lifespanDays") -> None:
    """Leftovers have a short lifespan: at most LEFTOVER_MAX_DAYS unless frozen."""
    if leftover and storage != "FREEZER" and lifespan_days > LEFTOVER_MAX_DAYS:
        raise validation_error(message("leftoverLifespan"), field)


def _expiry_for(added_date: DateString, lifespan_days: int) -> DateString:
    return add_days(added_date, lifespan_days)


def _clean_notes(notes: str) -> str | None:
    """An empty notes string clears the notes."""
    return trim(notes) or None


async def _prioritised_for(user: UserDoc) -> dict[str, Any]:
    today = clock.today(user.time_zone)
    foods = await food_item.find_active(user.household_id)
    result = prioritise(
        [
            {
                "id": str(food.id),
                "status": food["status"],
                "addedDate": food["addedDate"],
                "expiryDate": food["expiryDate"],
                "doc": food,
            }
            for food in foods
        ],
        today,
    )

    def view(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [to_food_view(item["doc"], today) for item in items]

    return {
        "today": today,
        "items": view(result["items"]),
        "cookFirst": view(result["cookFirst"]),
        "summary": result["summary"],
    }


async def _dispatch_safely(user: UserDoc) -> None:
    """Delivers due reminders first. A reminder failure is logged and never blocks the inventory."""
    try:
        await dispatch_due(user)
    except Exception:
        log.exception("Reminder dispatch failed")


async def list_foods(user: UserDoc) -> dict[str, Any]:
    await _dispatch_safely(user)
    listed = await _prioritised_for(user)
    return {"today": listed["today"], "summary": listed["summary"], "items": listed["items"]}


async def list_cook_first(user: UserDoc) -> dict[str, Any]:
    listed = await _prioritised_for(user)
    return {"today": listed["today"], "items": listed["cookFirst"]}


async def get_food(user: UserDoc, food_id: str) -> dict[str, Any]:
    """Any item the household owns, active or closed."""
    return to_food_view(await _find_owned(user, food_id), clock.today(user.time_zone))


def _user_expiry(added_date: DateString, lifespan_days: int) -> dict[str, Any]:
    """A person-set lifespan: the source is USER."""
    return {
        "lifespanDays": lifespan_days,
        "expiryDate": _expiry_for(added_date, lifespan_days),
        "expirySource": "USER",
        "estimateExplanation": USER_EXPLANATION,
    }


def _from_estimate(added_date: DateString, estimate: ExpiryEstimate) -> dict[str, Any]:
    """An estimate as stored fields. An expected expiry before the added date counts as the added date."""
    lifespan_days = lifespan_for(added_date, estimate["expiryDate"])
    return {
        "lifespanDays": lifespan_days,
        "expiryDate": _expiry_for(added_date, lifespan_days),
        "expirySource": estimate["source"],
        "estimateExplanation": estimate["explanation"],
    }


def _new_item(
    user: UserDoc, given: dict[str, Any], learned: list[LearnedLifespan], today: DateString
) -> dict[str, Any]:
    """The fields of a new item: owner, household, expected expiry and its source. A lifespan the person gave is
    kept as it is (source USER); otherwise the expiry is estimated from the pack's printed date, this household's
    history, the catalog, the category and a rough default, in that order of preference. With no storage given the
    catalog's usual place is used (the fridge for an unknown food). `given` holds the request's fields by their
    JSON names, plus addedDate."""
    name, quantity, added_date = given["name"], given["quantity"], given["addedDate"]
    leftover = given.get("leftover")
    catalog = find_reference("Leftovers") if leftover else find_reference(name)
    storage = given.get("storage") or (usual_storage(catalog) if catalog and not leftover else "FRIDGE")
    printed = given.get("printedDate")
    printed_date = printed if printed and is_usable_printed_date(printed, today) else None
    printed_type = (given.get("printedDateType") or "UNKNOWN") if printed_date else None
    opened_date = given.get("openedDate")
    if "lifespanDays" in given:
        fields = _user_expiry(added_date, given["lifespanDays"])
    else:
        estimate_input: EstimateInput = {
            "product": {"name": name},
            "catalogMatch": catalog,
            "category": given.get("category"),
            "storage": storage,
            "addedDate": added_date,
            "today": today,
            "printedDate": printed_date,
            "printedDateType": printed_type,
            "usageHistory": learned,
            "openedDate": opened_date,
        }
        fields = _from_estimate(added_date, estimate_expiry(estimate_input))
    price = given.get("price")
    values: dict[str, Any] = {
        "userId": user.id,
        "householdId": user.household_id,
        "name": name,
        "quantity": quantity,
        "unit": given["unit"],
        "addedDate": added_date,
        **fields,
        "printedDate": printed_date,
        "printedDateType": printed_type,
        "storage": storage,
        "openedDate": opened_date,
        "enteredLifespanDays": fields["lifespanDays"],
        "enteredStorage": storage,
        "enteredByUser": "lifespanDays" in given,
        "leftover": bool(leftover),
        "price": price,
        "priceQuantity": None if price is None else quantity,
    }
    notes = _clean_notes(given["notes"]) if "notes" in given else None
    if notes is not None:
        values["notes"] = notes
    return values


async def create_food(user: UserDoc, body: CreateFoodInput | dict[str, Any]) -> dict[str, Any]:
    """Adds one item. `body` is the request, or the same fields by their JSON names (a favourite's re-add)."""
    given = body.data() if isinstance(body, CreateFoodInput) else body
    today = clock.today(user.time_zone)
    added_date = given.get("addedDate") or today
    _assert_not_future(added_date, today)
    _assert_opened_date(given.get("openedDate"), added_date, today)
    learned = await learned_lifespans(user) if "lifespanDays" not in given else []
    values = _new_item(user, {**given, "addedDate": added_date}, learned, today)
    _assert_leftover_lifespan(values["leftover"], values["storage"], values["lifespanDays"])
    food = await food_item.create(values)
    await schedule_for_household(food)
    return to_food_view(food, today)


async def use_today(user: UserDoc, food_id: str) -> dict[str, Any]:
    """Makes an item due today. It can only bring the expected expiry forward: an item that is already due today
    or overdue is a 409, so this can never extend one. The lifespan it was entered with is left alone, so usual
    lifespans aren't learned from it."""
    today = clock.today(user.time_zone)
    food = await _find_owned(user, food_id)
    _assert_active(food)
    if food["expiryDate"] <= today:
        raise conflict(message("alreadyDue"))
    food["lifespanDays"] = diff_days(food["addedDate"], today)
    food["expiryDate"] = today
    food["expirySource"] = "USER"
    food["estimateExplanation"] = messages.ADJUSTED_PHOTO_CHECK
    await food_item.save_food(food)
    await schedule_for_household(food)
    return to_food_view(food, today)


async def update_food(user: UserDoc, food_id: str, body: UpdateFoodInput) -> dict[str, Any]:
    """Edits an active item. Changing the added date or lifespan works out the expiry again and reschedules the
    reminders."""
    today = clock.today(user.time_zone)
    food = await _find_owned(user, food_id)
    _assert_active(food)
    given = body.data()
    if "addedDate" in given:
        _assert_not_future(given["addedDate"], today)
    _assert_opened_date(given.get("openedDate"), given.get("addedDate", food["addedDate"]), today)
    _assert_leftover_lifespan(
        given.get("leftover", food["leftover"]),
        given.get("storage", food["storage"]),
        given.get("lifespanDays", food["lifespanDays"]),
    )
    for name in ("name", "quantity", "unit", "addedDate"):
        if name in given:
            food[name] = given[name]
    if "lifespanDays" in given:
        # Editing the estimate makes it the person's own.
        for name, value in _user_expiry(food["addedDate"], given["lifespanDays"]).items():
            food[name] = value
        food["enteredLifespanDays"] = given["lifespanDays"]
        food["enteredByUser"] = True
    if "notes" in given:
        notes = _clean_notes(given["notes"])
        if notes is None:
            food.unset("notes")
        else:
            food["notes"] = notes
    if "storage" in given:
        food["storage"] = food["enteredStorage"] = given["storage"]
    if "openedDate" in given:
        food["openedDate"] = given["openedDate"]
    if "leftover" in given:
        food["leftover"] = given["leftover"]
    # A new price covers the quantity the item has now; clearing it removes both.
    if "price" in given:
        food["price"] = given["price"]
        food["priceQuantity"] = None if given["price"] is None else food["quantity"]

    dates_changed = "addedDate" in given or "lifespanDays" in given
    if "addedDate" in given and "lifespanDays" not in given and food["expirySource"] == "PRINTED_DATE":
        # The pack's date doesn't move with the added date.
        food["lifespanDays"] = lifespan_for(food["addedDate"], food["expiryDate"])
    if dates_changed:
        food["expiryDate"] = _expiry_for(food["addedDate"], food["lifespanDays"])
    await food_item.save_food(food)
    if dates_changed:
        await schedule_for_household(food)
    return to_food_view(food, today)


ClosingAction = Literal["USED", "WASTED", "REMOVED"]


async def _close(user: UserDoc, food: FoodDoc, action: ClosingAction) -> dict[str, Any]:
    """Closes an item: logs the quantity that was left, sets closedAt and deletes its pending reminders."""
    quantity_left = food["quantity"]
    food["status"] = action
    food["closedAt"] = clock.now()
    await food_item.save_food(food)
    record = await usage_service.create_record(user, food, action, quantity_left, 0)
    await cancel_for_food(user.id, food.id)
    return {"food": to_food_view(food, clock.today(user.time_zone)), "usageRecord": to_usage_view(record)}


async def _use_part(user: UserDoc, food: FoodDoc, quantity: float) -> dict[str, Any]:
    """Uses part of an item: reduces its quantity, logs PARTIALLY_USED, and leaves it active."""
    remaining = _round(food["quantity"] - quantity)
    food["quantity"] = remaining
    await food_item.save_food(food)
    record = await usage_service.create_record(user, food, "PARTIALLY_USED", quantity, remaining)
    return {"food": to_food_view(food, clock.today(user.time_zone)), "usageRecord": to_usage_view(record)}


async def remove_food(user: UserDoc, food_id: str) -> None:
    """Soft delete: closes the item as REMOVED; its history is kept."""
    food = await _find_owned(user, food_id)
    _assert_active(food)
    await _close(user, food, "REMOVED")


async def use_food(user: UserDoc, food_id: str, body: UseFoodInput) -> dict[str, Any]:
    """Without a quantity (or with all of it) the whole item is used. A smaller quantity reduces the item and logs
    PARTIALLY_USED. More than is left is a 400."""
    food = await _find_owned(user, food_id)
    _assert_active(food)
    given = body.data()
    if "quantity" not in given or given["quantity"] == food["quantity"]:
        return await _close(user, food, "USED")
    if given["quantity"] > food["quantity"]:
        raise validation_error(f"There is only {number_text(food['quantity'])} {food['unit']} left.", "quantity")
    return await _use_part(user, food, given["quantity"])


async def waste_food(user: UserDoc, food_id: str) -> dict[str, Any]:
    """Closes the whole item as WASTED."""
    food = await _find_owned(user, food_id)
    _assert_active(food)
    return await _close(user, food, "WASTED")


async def bulk_create(user: UserDoc, body: BulkCreateInput) -> dict[str, Any]:
    """Adds a whole shopping haul: every row is checked first, then all are saved together (all or nothing), and
    each gets its reminders."""
    today = clock.today(user.time_zone)
    given = body.data()
    _assert_not_future(given["addedDate"], today)
    rows: list[dict[str, Any]] = given["items"]
    learned = await learned_lifespans(user) if any("lifespanDays" not in row for row in rows) else []
    values = [
        _new_item(
            user,
            {**row, "addedDate": given["addedDate"], "storage": row.get("storage", given.get("storage"))},
            learned,
            today,
        )
        for row in rows
    ]
    saved = await food_item.insert_many(values)
    for food in saved:
        await schedule_for_household(food)
    return {"items": [to_food_view(food, today) for food in saved]}


async def undo_last_action(user: UserDoc, food_id: str) -> dict[str, Any]:
    """Undoes the item's most recent action (used, partly used, wasted or removed) within UNDO_WINDOW. This
    replaces confirmation dialogs: the app acts at once and offers "Undo". The usage record is deleted so history
    stays accurate."""
    food = await _find_owned(user, food_id)
    record = await usage_service.latest_for_food(user, food.id)
    if record is None:
        raise conflict(message("nothingToUndo"))
    if clock.now() - record["createdAt"] > UNDO_WINDOW:
        raise conflict(message("undoExpired"))
    if record["action"] == "PARTIALLY_USED":
        food["quantity"] = _round(food["quantity"] + record["quantityUsed"])
    else:
        food["status"] = "ACTIVE"
        food.unset("closedAt")
        food["quantity"] = record["quantityUsed"]
    await food_item.save_food(food)
    await usage_service.delete_record(user, record)
    if record["action"] != "PARTIALLY_USED":
        await schedule_for_household(food)
    return to_food_view(food, clock.today(user.time_zone))


def _set_expiry(food: FoodDoc, expiry_date: DateString) -> None:
    """A new expected expiry, set through the lifespan, so expiryDate stays addedDate + lifespanDays."""
    food["lifespanDays"] = min(max(diff_days(food["addedDate"], expiry_date), 0), MAX_LIFESPAN)
    food["expiryDate"] = _expiry_for(food["addedDate"], food["lifespanDays"])


async def _recalculate(user: UserDoc, food: FoodDoc, today: DateString) -> None:
    """Estimates an item again after a move or opening. It can only bring the expected expiry forward: a new
    estimate that is the same or later changes nothing, and a rough FALLBACK guess never replaces a date the
    person set."""
    estimate_input: EstimateInput = {
        "product": {"name": food["name"]},
        "storage": food["storage"],
        "addedDate": food["addedDate"],
        "today": today,
        "printedDate": food["printedDate"],
        "printedDateType": food["printedDateType"],
        "usageHistory": await learned_lifespans(user),
        "openedDate": food["openedDate"],
    }
    if food["leftover"]:
        estimate_input["catalogMatch"] = find_reference("Leftovers")
    estimate = recalculate_expiry(food["expiryDate"], estimate_input)
    if estimate is None:
        return
    # A rough guess is no reason to override a date the person chose.
    if estimate["source"] == "FALLBACK" and food["expirySource"] == "USER":
        return
    fields = _from_estimate(food["addedDate"], estimate)
    # Never later, even once the added date's whole days are rounded.
    if fields["expiryDate"] >= food["expiryDate"]:
        return
    for name, value in fields.items():
        food[name] = value


def _set_by_user(food: FoodDoc, expiry_date: DateString, explanation: str) -> None:
    """A number of days the person gave: the expected expiry they chose (for a move, possibly later)."""
    _set_expiry(food, expiry_date)
    food["expirySource"] = "USER"
    food["estimateExplanation"] = explanation


async def open_food(user: UserDoc, food_id: str, body: OpenFoodInput) -> dict[str, Any]:
    """Marks an item as opened. Without `daysLeft`, the expected expiry is estimated again (the catalog's
    once-opened lifespan counted from the opened date) and only ever gets shorter. With `daysLeft`, the person chose
    how long it lasts once opened (source USER), still only if that is earlier."""
    today = clock.today(user.time_zone)
    food = await _find_owned(user, food_id)
    _assert_active(food)
    if food["openedDate"]:
        raise conflict(message("alreadyOpened"))
    given = body.data()
    opened_date = given.get("openedDate") or today
    _assert_opened_date(opened_date, food["addedDate"], today)

    food["lifespanBeforeOpened"] = food["lifespanDays"]
    food["sourceBeforeOpened"] = food["expirySource"]
    food["explanationBeforeOpened"] = food["estimateExplanation"]
    food["openedDate"] = opened_date
    if "daysLeft" in given:
        candidate = add_days(opened_date, given["daysLeft"])
        if candidate < food["expiryDate"]:
            _set_by_user(food, candidate, "You set how long this lasts once opened.")
    else:
        await _recalculate(user, food, today)
    await food_item.save_food(food)
    await schedule_for_household(food)
    return to_food_view(food, today)


async def undo_open(user: UserDoc, food_id: str) -> dict[str, Any]:
    """Undoes "Opened": clears the opened date and restores the lifespan from before."""
    food = await _find_owned(user, food_id)
    _assert_active(food)
    if not food["openedDate"] or food["lifespanBeforeOpened"] is None:
        raise conflict(message("notOpened"))
    food["lifespanDays"] = food["lifespanBeforeOpened"]
    food["expiryDate"] = _expiry_for(food["addedDate"], food["lifespanDays"])
    if food["sourceBeforeOpened"]:
        food["expirySource"] = food["sourceBeforeOpened"]
    if food["explanationBeforeOpened"] is not None:
        food["estimateExplanation"] = food["explanationBeforeOpened"]
    for name in ("openedDate", "lifespanBeforeOpened", "sourceBeforeOpened", "explanationBeforeOpened"):
        food[name] = None
    await food_item.save_food(food)
    await schedule_for_household(food)
    return to_food_view(food, clock.today(user.time_zone))


async def move_food(user: UserDoc, food_id: str, body: MoveFoodInput) -> dict[str, Any]:
    """Moves an item to another place. Without `daysLeft` the expected expiry is estimated again for the new place
    and only ever gets shorter. With `daysLeft` (counted from today) the person chose it (source USER), and that may
    be later, for example when moving food to the freezer."""
    today = clock.today(user.time_zone)
    food = await _find_owned(user, food_id)
    _assert_active(food)
    given = body.data()
    if food["storage"] == given["storage"]:
        raise validation_error(message("sameStorage"), "storage")
    if "daysLeft" in given:
        _assert_leftover_lifespan(food["leftover"], given["storage"], given["daysLeft"], "daysLeft")
    food["storage"] = given["storage"]
    if "daysLeft" in given:
        _set_by_user(food, add_days(today, given["daysLeft"]), "You set how long this lasts in its new place.")
    else:
        await _recalculate(user, food, today)
    await food_item.save_food(food)
    await schedule_for_household(food)
    return to_food_view(food, today)


async def snooze_food(user: UserDoc, food_id: str) -> dict[str, Any]:
    """Leaves an item out of push reminders until tomorrow, when it is reminded about again. It stays in the Cook
    First list and in-app reminders as usual."""
    today = clock.today(user.time_zone)
    food = await _find_owned(user, food_id)
    _assert_active(food)
    food["snoozedUntil"] = add_days(today, SNOOZE_DAYS)
    await food_item.save_food(food)
    return to_food_view(food, today)
