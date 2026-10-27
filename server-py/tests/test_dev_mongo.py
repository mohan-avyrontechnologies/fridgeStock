"""The local embedded MongoDB (scripts/dev-mongo.mjs): the persistent mode keeps its data across a restart in a
gitignored folder, and the empty mode for tests starts with nothing and leaves nothing behind."""

import json
import socket
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from tests.conftest import DEV_MONGO, SERVER_PY, EmbeddedMongo

REPO = SERVER_PY.parent


def accepts_connections(uri: str) -> bool:
    address = urlparse(uri)
    with socket.socket() as sock:
        sock.settimeout(5)
        return sock.connect_ex((address.hostname or "127.0.0.1", address.port or 27017)) == 0


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def mongo_eval(uri: str, script: str) -> object:
    """Runs a little JavaScript with the MongoDB driver the repository already has, and returns its JSON."""
    code = (
        "const { MongoClient } = require('mongodb');"
        f"(async () => {{ const client = await MongoClient.connect({json.dumps(uri)});"
        "const items = client.db('fridgestock').collection('items');"
        f"const result = await (async () => {{ {script} }})();"
        "console.log(JSON.stringify(result ?? null)); await client.close(); })();"
    )
    out = subprocess.run(["node", "-e", code], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def is_ignored(path: str) -> bool:
    return subprocess.run(["git", "check-ignore", "-q", path], cwd=REPO, check=False).returncode == 0


def test_persistent_mode_keeps_data_across_a_restart() -> None:
    with tempfile.TemporaryDirectory(dir=SERVER_PY, prefix=".test-db-persist-") as folder:
        args = ["--data-dir", str(Path(folder) / "data"), "--port", str(free_port())]
        first = EmbeddedMongo(args)
        try:
            mongo_eval(first.uri, "await items.insertOne({ name: 'Milk' });")
        finally:
            first.stop()
        assert not accepts_connections(first.uri)

        second = EmbeddedMongo(args)
        try:
            assert second.uri == first.uri
            assert mongo_eval(second.uri, "return (await items.find().toArray()).map((i) => i.name);") == ["Milk"]
        finally:
            second.stop()
        assert (Path(folder) / "data").exists()


def test_persistent_mode_defaults_to_the_gitignored_data_folder_on_port_27028() -> None:
    source = DEV_MONGO.read_text(encoding="utf-8")
    assert "option('--data-dir') ?? path.join(SERVER_PY, '.data')" in source
    assert "const PERSISTENT_PORT = 27028;" in source
    assert is_ignored("server-py/.data/")
    assert is_ignored("server-py/.test-db-abc/")


def test_empty_mode_starts_with_nothing_and_deletes_its_folder_when_stopped() -> None:
    mongo = EmbeddedMongo()
    try:
        assert mongo.db_path.parent == SERVER_PY
        assert mongo.db_path.name.startswith(".test-db-")
        assert mongo_eval(mongo.uri, "return await items.countDocuments();") == 0
    finally:
        mongo.stop()
    assert mongo.process.returncode == 0
    assert not mongo.db_path.exists()
    assert not accepts_connections(mongo.uri)
