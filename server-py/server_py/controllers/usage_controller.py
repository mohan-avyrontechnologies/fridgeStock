"""Usage history (server/src/controllers/usageController.ts)."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.auth import current_user
from server_py.middleware.http import json_response
from server_py.middleware.validate import validated
from server_py.schemas.food import PaginationInput
from server_py.services import usage_service


async def list_history(request: Request) -> Response:
    page = validated(request, PaginationInput, "query")
    return json_response(200, await usage_service.list_history(current_user(request), page))
