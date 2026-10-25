"""The MongoDB connection (server/src/config/db.ts). Only this module and the models talk to MongoDB directly.

In development, with no MONGO_URI, the server starts its own MongoDB through scripts/dev-mongo.mjs: a persistent
one (data in server-py/.data, port 27028), or with EPHEMERAL_DB=1 an empty throwaway one for end-to-end runs.
"""

import asyncio
import logging
import os
from datetime import UTC
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from server_py.config.env import env
from server_py.embedded_mongo import EmbeddedMongo

log = logging.getLogger(__name__)

_client: AsyncMongoClient[dict[str, Any]] | None = None
_database: AsyncDatabase[dict[str, Any]] | None = None
_embedded: EmbeddedMongo | None = None


async def resolve_mongo_uri() -> str:
    global _embedded
    if env.mongo_uri:
        return env.mongo_uri
    if env.is_production:
        raise RuntimeError("MONGO_URI must be set in production.")
    # Development fallback: an embedded MongoDB, so the app runs without Docker or a local mongod install.
    if os.environ.get("EPHEMERAL_DB") == "1":
        _embedded = await asyncio.to_thread(EmbeddedMongo)
        return f"{_embedded.uri}cook-first-e2e"
    _embedded = await asyncio.to_thread(EmbeddedMongo, [])
    log.warning("Using embedded MongoDB at %s (data in %s)", _embedded.uri, _embedded.db_path)
    return f"{_embedded.uri}cook-first"


async def connect(uri: str) -> AsyncDatabase[dict[str, Any]]:
    """Connect to the database the URI names (Mongoose's default, "test", when it names none). Dates come back
    as UTC datetimes, as Mongoose gives JavaScript Dates."""
    global _client, _database
    _client = AsyncMongoClient(uri, tz_aware=True, tzinfo=UTC)
    await _client.aconnect()
    _database = _client.get_default_database("test")
    return _database


def database() -> AsyncDatabase[dict[str, Any]]:
    if _database is None:
        raise RuntimeError("The database is not connected.")
    return _database


async def disconnect() -> None:
    global _client, _database, _embedded
    if _client is not None:
        await _client.close()
    _client = _database = None
    if _embedded is not None:
        await asyncio.to_thread(_embedded.stop)
        _embedded = None
