"""Food items (server/src/controllers/foodController.ts)."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.auth import current_user
from server_py.middleware.http import json_response
from server_py.middleware.validate import path_id, validated
from server_py.schemas.food import (
    BulkCreateInput,
    CreateFoodInput,
    MoveFoodInput,
    OpenFoodInput,
    UpdateFoodInput,
    UseFoodInput,
)
from server_py.services import food_service


async def use_today(request: Request) -> Response:
    return json_response(200, await food_service.use_today(current_user(request), path_id(request)))


async def list_foods(request: Request) -> Response:
    return json_response(200, await food_service.list_foods(current_user(request)))


async def fridge_stock(request: Request) -> Response:
    return json_response(200, await food_service.list_fridge_stock(current_user(request)))


async def get(request: Request) -> Response:
    return json_response(200, await food_service.get_food(current_user(request), path_id(request)))


async def create(request: Request) -> Response:
    body = validated(request, CreateFoodInput)
    return json_response(201, await food_service.create_food(current_user(request), body))


async def update(request: Request) -> Response:
    body = validated(request, UpdateFoodInput)
    return json_response(200, await food_service.update_food(current_user(request), path_id(request), body))


async def remove(request: Request) -> Response:
    await food_service.remove_food(current_user(request), path_id(request))
    return Response(status_code=204)


async def use(request: Request) -> Response:
    body = validated(request, UseFoodInput)
    return json_response(200, await food_service.use_food(current_user(request), path_id(request), body))


async def bulk_create(request: Request) -> Response:
    body = validated(request, BulkCreateInput)
    return json_response(201, await food_service.bulk_create(current_user(request), body))


async def undo(request: Request) -> Response:
    return json_response(200, await food_service.undo_last_action(current_user(request), path_id(request)))


async def open_food(request: Request) -> Response:
    body = validated(request, OpenFoodInput)
    return json_response(200, await food_service.open_food(current_user(request), path_id(request), body))


async def undo_open(request: Request) -> Response:
    return json_response(200, await food_service.undo_open(current_user(request), path_id(request)))


async def move(request: Request) -> Response:
    body = validated(request, MoveFoodInput)
    return json_response(200, await food_service.move_food(current_user(request), path_id(request), body))


async def waste(request: Request) -> Response:
    return json_response(200, await food_service.waste_food(current_user(request), path_id(request)))
