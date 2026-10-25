"""Shared pytest fixtures (server/src/tests/globalSetup.ts, setup.ts and helpers.ts).

`mongo_uri` is a MongoDB for the whole test session: TEST_MONGO_URI when it is set (CI uses a MongoDB service
container), otherwise an empty throwaway one from scripts/dev-mongo.mjs --empty. It is only started when a test
asks for it, directly or through `database` or `api`.

`database` connects once, to "cook-first-test", and creates every model's indexes. A test that uses it starts
with every collection empty, the clock unpinned and the rate limits reset, as setup.ts arranges before each test.
`api` is an HTTP client on the app, like supertest's `request(app)`.
"""

import os

# Before the app is imported: settings are read once, at import.
os.environ["NODE_ENV"] = "test"
os.environ["AUTH_RATE_LIMIT"] = "off"

from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import count
from typing import Any

import httpx
import pytest
from pymongo.asynchronous.database import AsyncDatabase

from server_py import db
from server_py.embedded_mongo import DEV_MONGO, SERVER_PY, EmbeddedMongo
from server_py.main import create_app
from server_py.models import ALL_MODELS
from server_py.models.base import ensure_indexes
from server_py.routes.index import auth_limiter
from server_py.services import clock

__all__ = ["DEV_MONGO", "SERVER_PY", "EmbeddedMongo"]


@pytest.fixture(scope="session")
def mongo_uri() -> Iterator[str]:
    if uri := os.environ.get("TEST_MONGO_URI"):
        yield uri
        return
    mongo = EmbeddedMongo()
    try:
        yield mongo.uri
    finally:
        mongo.stop()


@pytest.fixture(scope="session")
async def _connected(mongo_uri: str) -> AsyncIterator[AsyncDatabase[dict[str, Any]]]:
    database = await db.connect(f"{mongo_uri.rstrip('/')}/cook-first-test")
    for model in ALL_MODELS:
        await ensure_indexes(model)
    try:
        yield database
    finally:
        await db.disconnect()


@pytest.fixture
async def database(_connected: AsyncDatabase[dict[str, Any]]) -> AsyncIterator[AsyncDatabase[dict[str, Any]]]:
    clock.set(None)
    auth_limiter.reset()
    for name in await _connected.list_collection_names():
        await _connected[name].delete_many({})
    yield _connected
    clock.set(None)


@pytest.fixture
async def api(database: AsyncDatabase[dict[str, Any]]) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=create_app(connect=False), client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        yield client


_numbers = count(1)


@dataclass
class Account:
    """A registered user, as helpers.ts's registerUser returns one."""

    token: str
    user: dict[str, Any]
    password: str

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def register_user(api: httpx.AsyncClient, **overrides: Any) -> Account:
    number = next(_numbers)
    body = {
        "name": f"User {number}",
        "email": f"user{number}@example.com",
        "password": "correct horse battery",
        "timeZone": "UTC",
        **overrides,
    }
    res = await api.post("/api/auth/register", json=body)
    assert res.status_code == 201, res.text
    return Account(res.json()["token"], res.json()["user"], body["password"])


def set_today(date_key: str) -> None:
    """Pins "now" to midday UTC on the given calendar date."""
    clock.set(datetime.fromisoformat(f"{date_key}T12:00:00").replace(tzinfo=UTC))
