"""Favourites: foods re-added with one tap (server/src/services/favouriteService.ts). Private to their owner;
another user's favourite is a 404."""

from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from server_py.models import favourite as favourites
from server_py.models.favourite import FavouriteDoc
from server_py.models.user import UserDoc
from server_py.schemas.food import FavouriteInput
from server_py.schemas.messages import message
from server_py.services import clock
from server_py.services.errors import AppError, conflict
from server_py.services.food_service import create_food
from server_py.services.views import to_favourite_view
from server_py.shared.js import trim


def _not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Favourite not found.")


async def _find_owned(user: UserDoc, favourite_id: str) -> FavouriteDoc:
    found = (
        await favourites.find_owned(ObjectId(favourite_id), user.id)
        if len(favourite_id) == 24 and ObjectId.is_valid(favourite_id)
        else None
    )
    if found is None:
        raise _not_found()
    return found


async def list_favourites(user: UserDoc) -> list[dict[str, Any]]:
    return [to_favourite_view(favourite) for favourite in await favourites.list_for(user.id)]


async def create_favourite(user: UserDoc, body: FavouriteInput) -> dict[str, Any]:
    given = body.data()
    name_key = trim(given["name"]).lower()
    if await favourites.exists(user.id, name_key):
        raise conflict(message("favouriteExists"), "name")
    try:
        return to_favourite_view(await favourites.create({**given, "userId": user.id, "nameKey": name_key}))
    except DuplicateKeyError:
        # Two simultaneous saves can both pass the exists check.
        raise conflict(message("favouriteExists"), "name") from None


async def remove_favourite(user: UserDoc, favourite_id: str) -> None:
    favourite = await _find_owned(user, favourite_id)
    await favourites.delete(favourite.id, user.id)


async def add_from_favourite(user: UserDoc, favourite_id: str) -> dict[str, Any]:
    """One-tap re-add: a new item from the favourite, added today in the user's time zone."""
    favourite = await _find_owned(user, favourite_id)
    return await create_food(
        user,
        {
            "name": favourite["name"],
            "quantity": favourite["quantity"],
            "unit": favourite["unit"],
            "lifespanDays": favourite["lifespanDays"],
            "storage": favourite["storage"],
            "addedDate": clock.today(user.time_zone),
        },
    )
