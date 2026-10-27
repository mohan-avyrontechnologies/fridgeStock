"""Project rules that must never be broken, each checked directly (server/src/tests/rules.test.ts).

The scoping test walks the journey the routes built so far allow (food, history, favourites, suggestions, the
config routes); each later phase adds its routes to it, until it is the whole of rules.test.ts's journey.
"""

import json
import re
from typing import Any

import httpx
import pytest
from bson import ObjectId

from server_py.models.user import USER
from server_py.routes.index import auth_limiter
from tests.conftest import COMMANDS, SERVER_PY, food, register_user, set_today

pytestmark = pytest.mark.phase2

SRC = SERVER_PY / "server_py"
# Collections whose every read and write must name the user (or, for shared data, the household).
SCOPED = {"fooditems", "usagerecords", "notifications", "favourites"}
# Shared within a household: scoped by the household's id.
SHARED = {"fooditems", "usagerecords"}
COMMAND_NAMES = {"find", "insert", "update", "delete", "aggregate", "count", "distinct", "findAndModify"}


def _scopes(command: dict[str, Any]) -> list[object]:
    """The filters (or inserted documents, or the first $match) that decide whose data a command touches."""
    if "find" in command:
        return [command.get("filter", {})]
    if "insert" in command:
        return list(command["documents"])
    if "update" in command:
        return [update["q"] for update in command["updates"]]
    if "delete" in command:
        return [delete["q"] for delete in command["deletes"]]
    if "aggregate" in command:
        return [command["pipeline"][0].get("$match")]
    if "distinct" in command or "count" in command:
        return [command.get("query", {})]
    return [command.get("query", {})]


def _collection(command: dict[str, Any]) -> tuple[str, str] | None:
    for name in COMMAND_NAMES:
        if name in command and isinstance(command[name], str):
            return name, command[name]
    return None


async def test_every_read_and_write_carries_the_user_id_or_the_household_id(api: httpx.AsyncClient) -> None:
    set_today("2026-09-29")
    s = await register_user(api)
    h = s.headers
    COMMANDS.commands.clear()
    COMMANDS.recording = True
    try:
        a = (await api.post("/api/foods", headers=h, json=food(lifespanDays=2, quantity=2))).json()
        b = (await api.post("/api/foods", headers=h, json=food(lifespanDays=9))).json()
        await api.get("/api/foods", headers=h)
        await api.get("/api/foods/fridgestock", headers=h)
        await api.get(f"/api/foods/{a['id']}", headers=h)
        await api.put(f"/api/foods/{a['id']}", headers=h, json={"lifespanDays": 1})
        await api.post(f"/api/foods/{a['id']}/use", headers=h, json={"quantity": 1})
        await api.post(f"/api/foods/{a['id']}/waste", headers=h, json={})
        await api.delete(f"/api/foods/{b['id']}", headers=h)
        await api.get("/api/usage", headers=h)
        await api.post(f"/api/foods/{b['id']}/undo", headers=h)
        bulk = {
            "addedDate": "2026-09-29",
            "items": [{"name": "Peas", "quantity": 1, "unit": "pack", "lifespanDays": 9}],
        }
        await api.post("/api/foods/bulk", headers=h, json=bulk)
        fav = (
            await api.post(
                "/api/favourites", headers=h, json={"name": "Milk", "quantity": 1, "unit": "l", "lifespanDays": 5}
            )
        ).json()
        await api.get("/api/favourites", headers=h)
        await api.post(f"/api/favourites/{fav['id']}/add", headers=h)
        await api.delete(f"/api/favourites/{fav['id']}", headers=h)
        c = (await api.post("/api/foods", headers=h, json=food(name="Milk", lifespanDays=9))).json()
        await api.post(f"/api/foods/{c['id']}/open", headers=h, json={})
        await api.delete(f"/api/foods/{c['id']}/open", headers=h)
        await api.post(f"/api/foods/{c['id']}/move", headers=h, json={"storage": "FREEZER"})
        await api.post(f"/api/foods/{c['id']}/use-today", headers=h)
        await api.get("/api/suggestions/lifespans", headers=h)
        await api.get("/api/push/config", headers=h)
        await api.get("/api/ai/status", headers=h)
    finally:
        COMMANDS.recording = False

    operations = [(found, command) for command in COMMANDS.commands if (found := _collection(command))]
    data = [(kind, name, command) for (kind, name), command in operations if name in SCOPED]
    assert {name for _kind, name, _command in data} == SCOPED

    user = await USER.collection().find_one({"_id": ObjectId(s.user["id"])})
    assert user is not None
    household = str(user["householdId"])
    assert household != s.user["id"]
    unscoped: list[str] = []
    by_user_only: set[str] = set()
    for kind, name, command in data:
        for scope in _scopes(command):
            text = json.dumps(scope, default=str)
            if name in SHARED:
                if household not in text and s.user["id"] not in text:
                    unscoped.append(f"{name}.{kind} {text}")
                if household not in text:
                    by_user_only.add(f"{name}.{kind}")
            elif s.user["id"] not in text:
                unscoped.append(f"{name}.{kind} {text}")
    assert unscoped == []
    # Shared data is scoped by the household's id. The only exceptions: the learned-lifespans lookup (the user's
    # own items), and saving a document that was just found through the household (Mongoose, and so the model
    # layer here, adds the owner's id to that filter as the shard key).
    assert by_user_only == {"fooditems.find", "fooditems.update"}


def test_the_priority_engine_imports_nothing_that_touches_a_database_http_or_the_clock() -> None:
    source = (SRC / "services" / "priority_engine.py").read_text(encoding="utf-8")
    imports = re.findall(r"^(?:from|import) ([\w.]+)", source, re.MULTILINE)
    assert imports
    for name in imports:
        assert not re.search(r"pymongo|bson|starlette|fastapi|\.models|\.controllers|\.routes|clock", name), name


class TestPasswords:
    async def test_are_hashed_with_bcrypt_at_cost_12(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api)
        user = await USER.collection().find_one({"_id": ObjectId(s.user["id"])})
        assert user is not None
        assert re.match(r"^\$2[aby]\$12\$", user["passwordHash"])

    async def test_are_never_returned_by_register_login_or_me(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api)
        login = await api.post("/api/auth/login", json={"email": s.user["email"], "password": s.password})
        me = await api.get("/api/auth/me", headers=s.headers)
        for body in [s.user, login.json(), me.json()]:
            text = json.dumps(body)
            assert not re.search(r'passwordHash|"password"', text)
            assert s.password not in text

    def test_are_never_logged_the_request_log_has_only_method_route_status_and_time(self) -> None:
        source = (SRC / "middleware" / "http.py").read_text(encoding="utf-8")
        logged = source[source.index("line = {") : source.index("sys.stdout.write")]
        assert not re.search(r"body|password|headers|authorization", logged, re.IGNORECASE)


class TestSecrets:
    def test_env_example_is_committed_and_env_is_git_ignored(self) -> None:
        assert (SERVER_PY / ".env.example").exists()
        ignored = (SERVER_PY.parent / ".gitignore").read_text(encoding="utf-8").splitlines()
        assert ".env" in ignored

    def test_jwt_secret_and_database_url_come_only_from_the_environment(self) -> None:
        source = (SRC / "config" / "env.py").read_text(encoding="utf-8")
        assert 'environ.get("JWT_SECRET")' in source
        assert 'environ.get("MONGO_URI"' in source
        assert "JWT_SECRET must be set in production" in source


class TestHttpHardening:
    async def test_sends_helmet_security_headers(self, api: httpx.AsyncClient) -> None:
        res = await api.get("/api/health")
        assert res.headers["x-content-type-options"] == "nosniff"
        assert "content-security-policy" in res.headers
        assert "x-powered-by" not in res.headers

    async def test_allows_cors_only_for_the_client_origin(self, api: httpx.AsyncClient) -> None:
        allowed = await api.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
        other = await api.get("/api/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in other.headers

    async def test_rate_limits_authentication_to_20_per_15_minutes_per_ip(
        self, api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert (auth_limiter.window_ms, auth_limiter.limit) == (15 * 60 * 1000, 20)
        monkeypatch.setenv("AUTH_RATE_LIMIT", "on")
        body = {"email": "nobody@example.com", "password": "wrong-password"}
        statuses: list[int] = []
        for _ in range(21):
            res = await api.post("/api/auth/login", json=body, headers={"X-Forwarded-For": "203.0.113.7"})
            statuses.append(res.status_code)
        assert all(status == 401 for status in statuses[:20])
        assert statuses[20] == 429
        # A different address has its own allowance.
        other = await api.post("/api/auth/login", json=body, headers={"X-Forwarded-For": "198.51.100.9"})
        assert other.status_code == 401
