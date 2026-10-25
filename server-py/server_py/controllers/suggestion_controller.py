"""Lifespan suggestions (server/src/controllers/suggestionController.ts)."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.auth import current_user
from server_py.middleware.http import json_response
from server_py.services import suggestion_service


async def lifespans(request: Request) -> Response:
    return json_response(200, {"items": await suggestion_service.learned_lifespans(current_user(request))})
