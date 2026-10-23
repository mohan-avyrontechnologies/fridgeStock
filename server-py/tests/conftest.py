"""Shared pytest fixtures.

`mongo_uri` is a MongoDB for the whole test session: TEST_MONGO_URI when it is set (CI uses a MongoDB service
container), otherwise an empty throwaway one from scripts/dev-mongo.mjs --empty, like the TypeScript server's
globalSetup.ts. It is only started when a test asks for it.
"""

import json
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

SERVER_PY = Path(__file__).resolve().parents[1]
DEV_MONGO = SERVER_PY / "scripts" / "dev-mongo.mjs"


class EmbeddedMongo:
    """scripts/dev-mongo.mjs, running. Closing its standard input stops it (and deletes an empty one's folder)."""

    def __init__(self, args: list[str] | None = None) -> None:
        """With no arguments, the empty mode; with --data-dir and --port, the persistent one."""
        self.process = subprocess.Popen(
            ["node", str(DEV_MONGO), *(args if args is not None else ["--empty"])],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        assert self.process.stdout is not None
        ready = json.loads(self.process.stdout.readline())
        self.uri: str = ready["uri"]
        self.db_path = Path(ready["dbPath"])

    def stop(self) -> None:
        assert self.process.stdin is not None
        self.process.stdin.close()
        self.process.wait(timeout=60)


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
