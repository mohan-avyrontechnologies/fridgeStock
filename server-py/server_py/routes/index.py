"""Every route, in the order server/src/routes/index.ts registers them. docs/API.md lists the same routes in the
same order, which a test checks; routes not ported yet arrive with their phase (docs/PYTHON_MIGRATION.md §6).

Requests flow: route → middleware (rate limit, auth, validation) → controller → service.
"""

from typing import Final

from starlette.requests import Request
from starlette.responses import Response

from server_py.controllers import ai_controller, auth_controller, push_controller
from server_py.middleware.auth import require_auth
from server_py.middleware.http import json_response
from server_py.middleware.rate_limit import RateLimit
from server_py.middleware.validate import validate
from server_py.routes.router import Router
from server_py.schemas.auth import LoginInput, RegisterInput, UpdateAccountInput

_FIFTEEN_MINUTES: Final = 15 * 60 * 1000
_TOO_MANY_ATTEMPTS: Final = "Too many attempts. Try again later."

# Authentication routes: 20 requests per 15 minutes per IP address, shared by register, login, joining a
# household and deleting the account.
auth_limiter: Final = RateLimit(_FIFTEEN_MINUTES, 20, _TOO_MANY_ATTEMPTS)

router: Final = Router("/api")


async def _health(_request: Request) -> Response:
    return json_response(200, {"ok": True})


router.get("/health", _health)

router.post("/auth/register", auth_limiter, validate(RegisterInput), auth_controller.register)
router.post("/auth/login", auth_limiter, validate(LoginInput), auth_controller.login)

# Everything below requires a valid bearer token.
router.use(require_auth)

router.get("/auth/me", auth_controller.me)
router.put("/auth/me", validate(UpdateAccountInput), auth_controller.update_me)

router.get("/push/config", push_controller.config)

router.get("/ai/status", ai_controller.status)
