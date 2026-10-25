"""Request validation (server/src/middleware/validate.ts).

Parses the body, query string or path values with a schema; the parsed model replaces the raw input. This
server-side check is the only validation that counts.
"""

from typing import Literal

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.http import Step
from server_py.schemas.base import RequestModel
from server_py.schemas.zod import MISSING, ZodIssue
from server_py.services.errors import validation_error

Source = Literal["body", "query", "params"]


def query_object(request: Request) -> dict[str, str | list[str]]:
    """`req.query` with Express 5's "simple" parser (node:querystring): a repeated key gives a list."""
    query: dict[str, str | list[str]] = {}
    for key, value in request.query_params.multi_items():
        existing = query.get(key)
        if existing is None:
            query[key] = value
        elif isinstance(existing, list):
            existing.append(value)
        else:
            query[key] = [existing, value]
    return query


def validate(model: type[RequestModel], source: Source = "body") -> Step:
    async def check(request: Request) -> Response | None:
        state = request.scope.setdefault("state", {})
        raw = state.get(source, MISSING) if source != "query" else query_object(request)
        try:
            parsed = model.parse_input(raw)
        except ZodIssue as issue:
            raise validation_error(issue.message, issue.field) from None
        state[f"valid_{source}"] = parsed
        return None

    return check


def validated[M: RequestModel](request: Request, model: type[M], source: Source = "body") -> M:
    """The value `validate(model, source)` parsed for this request."""
    parsed = request.scope.get("state", {}).get(f"valid_{source}")
    assert isinstance(parsed, model)
    return parsed


def path_id(request: Request) -> str:
    """The route's :id, decoded (`String(req.params.id)`). Other path values are checked with a schema."""
    return str(request.scope.get("state", {}).get("params", {}).get("id", ""))
