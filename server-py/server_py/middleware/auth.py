"""Login check (server/src/middleware/auth.ts).

Verifies the bearer token and attaches the user. The user's identity comes only from here: never from the body,
query string or URL.
"""

from starlette.requests import Request
from starlette.responses import Response

from server_py.models.user import UserDoc
from server_py.services.auth_service import find_user_by_id
from server_py.services.errors import unauthenticated
from server_py.services.token import verify_token


async def require_auth(request: Request) -> Response | None:
    # `(header ?? '').split(' ')`: "Bearer <token>", where anything after a second space is ignored.
    parts = (request.headers.get("authorization") or "").split(" ")
    scheme, token = parts[0], parts[1] if len(parts) > 1 else ""
    if scheme != "Bearer" or not token:
        raise unauthenticated()
    user_id = verify_token(token)
    if not user_id:
        raise unauthenticated()
    user = await find_user_by_id(user_id)
    if not user:
        raise unauthenticated()
    request.scope.setdefault("state", {})["user"] = user
    return None


def current_user(request: Request) -> UserDoc:
    user = request.scope.get("state", {}).get("user")
    if not isinstance(user, UserDoc):
        raise unauthenticated()
    return user
