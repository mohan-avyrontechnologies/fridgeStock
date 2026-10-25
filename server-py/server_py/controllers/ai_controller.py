"""AI features (server/src/controllers/aiController.ts). Phase 1 has the status."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.auth import current_user
from server_py.middleware.http import json_response
from server_py.services import ai_service


async def status(request: Request) -> Response:
    return json_response(200, await ai_service.status(current_user(request)))
