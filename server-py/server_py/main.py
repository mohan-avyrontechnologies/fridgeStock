"""The app (server/src/app.ts and index.ts): `uvicorn server_py.main:app`.

Starting up prints the AI warnings, connects to MongoDB and runs the start-up migrations; the scheduled jobs
arrive in Phase 4.
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from server_py import db
from server_py.config.env import ai_startup_warnings, env
from server_py.middleware.http import BodyParser, ExpressSend, RequestLog, SecurityHeaders, error_response
from server_py.models.migrations import ensure_all_indexes, run_migrations
from server_py.routes.index import router
from server_py.routes.router import ApiRouter

log = logging.getLogger("server_py")


async def connect_database() -> None:
    await db.connect(await db.resolve_mongo_uri())
    await ensure_all_indexes()
    await run_migrations()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    for warning in ai_startup_warnings(env.ai, env.is_production):
        log.warning("WARNING: %s", warning)
    await connect_database()
    log.warning("API listening on http://localhost:%s/api", env.port)
    try:
        yield
    finally:
        await db.disconnect()


async def _not_found(_request: Request, _error: Exception) -> Response:
    return error_response(404, "NOT_FOUND", "Route not found.")


def create_app(*, connect: bool = True) -> FastAPI:
    """The app; `connect=False` leaves the database to the caller (the tests connect once for all of them)."""
    app = FastAPI(
        title="Cook First API",
        lifespan=lifespan if connect else None,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    router.register_openapi(app)
    app.add_exception_handler(HTTPException, _not_found)
    # Added inside out: a request meets SecurityHeaders first, as helmet and cors come first in app.ts.
    app.add_middleware(ApiRouter, router=router)
    app.add_middleware(BodyParser)
    app.add_middleware(ExpressSend)
    app.add_middleware(RequestLog)
    app.add_middleware(SecurityHeaders)
    return app


app = create_app()
