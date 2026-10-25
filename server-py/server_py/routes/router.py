"""An Express router for FastAPI: routes run in registration order, each as a chain of middleware and a
controller, so requests are handled exactly as server/src/routes/index.ts handles them.

What Express does that FastAPI's own routing doesn't:
- Paths match without regard to case and with or without one trailing slash, against the path as sent
  (still percent-encoded: "/api/heal%74h" is not "/api/health"). HEAD runs the GET route.
- `router.use(middleware)` runs for every request that gets past the routes before it, matched or not. That is
  how `requireAuth` makes an unknown path under /api a 401 without a token and a 404 with one.
- Each step may answer (an error, a 429) and stop the chain. Headers a step adds (the rate-limit ones) go on
  whatever response is sent.

`ApiRouter` is the ASGI middleware that dispatches /api; the same routes are also registered with FastAPI so its
OpenAPI document describes them.
"""

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final
from urllib.parse import unquote_to_bytes

from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

from server_py.middleware.http import Step, error_response, json_response
from server_py.models.base import DocumentValidationError
from server_py.services.errors import AppError

log = logging.getLogger(__name__)

Method = str


@dataclass(frozen=True)
class Route:
    method: Method
    path: str
    steps: tuple[Step, ...]
    pattern: re.Pattern[str]
    params: tuple[str, ...]


def _compile(path: str) -> tuple[re.Pattern[str], tuple[str, ...]]:
    """path-to-regexp as Express 5 uses it: ":name" is one segment, case-insensitive, optional trailing slash."""
    params: list[str] = []
    pattern = ""
    for part in re.split(r"(:[A-Za-z_][A-Za-z0-9_]*)", path):
        if part.startswith(":"):
            params.append(part[1:])
            pattern += "([^/]+?)"
        else:
            pattern += re.escape(part)
    return re.compile(f"{pattern}/?", re.IGNORECASE), tuple(params)


def _with_headers(request: Request, response: Response) -> Response:
    for name, value in request.scope.get("state", {}).get("response_headers", {}).items():
        response.headers[name] = value
    return response


def _error(error: AppError) -> Response:
    return json_response(error.status, error.body())


_INTERNAL: Final = "Something went wrong. Please try again."


async def run_steps(request: Request, steps: Sequence[Step]) -> Response:
    """Run a chain; errors become `{error: {code, message, field?}}` responses (errorHandler.ts)."""
    try:
        for step in steps:
            response = await step(request)
            if response is not None:
                return _with_headers(request, response)
    except AppError as error:
        return _with_headers(request, _error(error))
    except DocumentValidationError as error:
        # A database-level rule caught something the request schema didn't.
        field, detail = next(iter(error.errors.items()))
        return _with_headers(request, _error(AppError(400, "VALIDATION_ERROR", detail, field)))
    except Exception:
        # Logged on the server only. The response never includes a stack trace, and request bodies (which may
        # hold passwords) are never logged.
        log.exception("Unexpected error")
        return _with_headers(request, error_response(500, "INTERNAL", _INTERNAL))
    return _with_headers(request, error_response(404, "NOT_FOUND", "Route not found."))


def _decode(value: str) -> str:
    """decodeURIComponent; ValueError for a malformed escape (Express then fails the request)."""
    return unquote_to_bytes(value).decode("utf-8")


class Router:
    """The routes under /api, in order, as `Router()` holds them."""

    def __init__(self, prefix: str = "/api") -> None:
        self.prefix = prefix
        self.routes: list[Route] = []
        # Middleware added with use(), and how many routes were registered before each.
        self.uses: list[tuple[int, Step]] = []

    def add(self, method: Method, path: str, *steps: Step) -> None:
        pattern, params = _compile(path)
        before = tuple(step for count, step in self.uses if count <= len(self.routes))
        self.routes.append(Route(method, path, (*before, *steps), pattern, params))

    def get(self, path: str, *steps: Step) -> None:
        self.add("GET", path, *steps)

    def post(self, path: str, *steps: Step) -> None:
        self.add("POST", path, *steps)

    def put(self, path: str, *steps: Step) -> None:
        self.add("PUT", path, *steps)

    def delete(self, path: str, *steps: Step) -> None:
        self.add("DELETE", path, *steps)

    def use(self, step: Step) -> None:
        self.uses.append((len(self.routes), step))

    def registered(self) -> list[tuple[Method, str]]:
        """Every method and path, in order (what docs/API.md lists)."""
        return [(route.method, route.path) for route in self.routes]

    def match(self, method: Method, path: str) -> tuple[Route, dict[str, str]] | None:
        """The first route for this method and path (relative to the prefix, still percent-encoded)."""
        wanted = "GET" if method == "HEAD" else method
        for route in self.routes:
            if route.method != wanted:
                continue
            found = route.pattern.fullmatch(path)
            if found:
                return route, dict(zip(route.params, found.groups(), strict=True))
        return None

    def strip_prefix(self, raw_path: str) -> str | None:
        """The path below the prefix ("/" for the prefix itself), or None if it isn't under it."""
        head = raw_path[: len(self.prefix)]
        rest = raw_path[len(self.prefix) :]
        if head.lower() != self.prefix.lower() or (rest and not rest.startswith("/")):
            return None
        return rest or "/"

    async def handle(self, request: Request, path: str) -> Response:
        found = self.match(request.method, path)
        if found is None:
            # No route: every use() middleware still runs (requireAuth), then "Route not found."
            return await run_steps(request, [step for _count, step in self.uses])
        route, raw_params = found
        try:
            request.scope.setdefault("state", {})["params"] = {name: _decode(v) for name, v in raw_params.items()}
        except ValueError:
            log.exception("Could not decode a path parameter")
            return error_response(500, "INTERNAL", _INTERNAL)
        return await run_steps(request, route.steps)

    def register_openapi(self, app: FastAPI) -> None:
        """Describe every route to FastAPI, for its OpenAPI document. Requests never reach these: ApiRouter
        answers them first."""
        for route in self.routes:
            path = self.prefix + re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"{\1}", route.path)

            async def endpoint(request: Request, route: Route = route) -> Response:
                return await run_steps(request, route.steps)

            app.add_api_route(path, endpoint, methods=[route.method], name=f"{route.method} {route.path}")


class ApiRouter:
    """ASGI middleware that hands every request under the prefix to the router; anything else goes on (to a
    404, as `notFoundRoute` gives)."""

    def __init__(self, app: ASGIApp, router: Router) -> None:
        self.app = app
        self.router = router

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        raw: Any = scope.get("raw_path") or scope["path"].encode("utf-8")
        path = self.router.strip_prefix(raw.decode("latin-1").split("?")[0])
        if path is None:
            await self.app(scope, receive, send)
            return
        response = await self.router.handle(Request(scope, receive), path)
        await response(scope, receive, send)
