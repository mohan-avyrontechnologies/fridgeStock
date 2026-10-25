"""Sign-up, sign-in and the signed-in account (server/src/controllers/authController.ts)."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.auth import current_user
from server_py.middleware.http import json_response
from server_py.middleware.validate import validated
from server_py.schemas.auth import LoginInput, RegisterInput, UpdateAccountInput
from server_py.services import auth_service
from server_py.services.views import to_user_view


async def register(request: Request) -> Response:
    return json_response(201, await auth_service.register(validated(request, RegisterInput)))


async def login(request: Request) -> Response:
    return json_response(200, await auth_service.login(validated(request, LoginInput)))


async def me(request: Request) -> Response:
    return json_response(200, {"user": to_user_view(current_user(request))})


async def update_me(request: Request) -> Response:
    user = await auth_service.update_account(current_user(request), validated(request, UpdateAccountInput))
    return json_response(200, {"user": user})
