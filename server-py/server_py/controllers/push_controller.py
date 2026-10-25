"""Push settings (server/src/controllers/pushController.ts). Phase 1 has the configuration."""

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.http import json_response
from server_py.services import push_service


async def config(_request: Request) -> Response:
    return json_response(200, push_service.config())
