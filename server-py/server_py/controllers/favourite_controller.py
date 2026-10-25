"""Favourites (server/src/controllers/favouriteController.ts)."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.auth import current_user
from server_py.middleware.http import json_response
from server_py.middleware.validate import path_id, validated
from server_py.schemas.food import FavouriteInput
from server_py.services import favourite_service


async def list_favourites(request: Request) -> Response:
    return json_response(200, {"items": await favourite_service.list_favourites(current_user(request))})


async def create(request: Request) -> Response:
    body = validated(request, FavouriteInput)
    return json_response(201, await favourite_service.create_favourite(current_user(request), body))


async def remove(request: Request) -> Response:
    await favourite_service.remove_favourite(current_user(request), path_id(request))
    return Response(status_code=204)


async def add(request: Request) -> Response:
    return json_response(201, await favourite_service.add_from_favourite(current_user(request), path_id(request)))
