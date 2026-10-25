"""The API contract: error format and response shapes (server/src/tests/api.test.ts).

Phase 1 ports the tests that need only the Phase 1 routes. The food tests ("food items have their stored
fields...", "GET /foods returns active items...", the POST/PUT/close reminder tests, and the database
validation error, which comes from the food item model) arrive with Phase 2.
"""

import gzip
from typing import get_args

import httpx
import pytest

from server_py.services import auth_service
from server_py.services.errors import ErrorCode
from tests.conftest import Account, register_user, set_today

pytestmark = pytest.mark.phase1

ERROR_CODES = get_args(ErrorCode)


@pytest.fixture
async def account(api: httpx.AsyncClient) -> Account:
    set_today("2026-09-29")
    return await register_user(api)


class TestErrors:
    async def test_every_error_has_a_known_code_and_a_message_and_never_a_stack_trace(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        responses = [
            await api.get("/api/foods"),  # 401
            await api.get("/api/nothing-here", headers=account.headers),  # 404
            await api.put("/api/auth/me", headers=account.headers, json={"name": ""}),  # 400
            await api.post(
                "/api/auth/register", json={"name": "Dup", "email": account.user["email"], "password": "longenough"}
            ),  # 409
            await api.post("/api/auth/login", json={"email": account.user["email"], "password": "wrong-password"}),
        ]
        assert [r.status_code for r in responses] == [401, 404, 400, 409, 401]
        for res in responses:
            assert res.json()["error"]["code"] in ERROR_CODES
            assert isinstance(res.json()["error"]["message"], str)
            assert "stack" not in res.text
            assert "Traceback" not in res.text

    async def test_an_unexpected_failure_is_500_internal_with_a_generic_message(
        self, api: httpx.AsyncClient, account: Account, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom(*_args: object) -> None:
            raise RuntimeError("boom at secret.py:12")

        monkeypatch.setattr(auth_service, "update_account", boom)
        res = await api.put("/api/auth/me", headers=account.headers, json={})
        assert res.status_code == 500
        assert res.json() == {"error": {"code": "INTERNAL", "message": "Something went wrong. Please try again."}}

    async def test_a_body_that_cant_be_read_is_the_clients_4xx_never_a_500(
        self, api: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        async def login(encoding: str, body: bytes) -> httpx.Response:
            headers = {"Content-Type": "application/json", "Content-Encoding": encoding}
            return await api.post("/api/auth/login", headers=headers, content=body)

        unknown = await login("zstd-x", b'{"email":"a@example.com","password":"x"}')
        corrupt = await login("gzip", b'{"email":"a@example.com","password":"x"}')
        assert unknown.status_code == 415
        assert corrupt.status_code == 400
        for res in (unknown, corrupt):
            assert res.json() == {
                "error": {"code": "VALIDATION_ERROR", "message": "The request body couldn't be read."}
            }
            assert "zstd" not in res.text
        # Nothing unexpected happened, so nothing was logged as a server error.
        assert not [record for record in caplog.records if record.levelname == "ERROR"]
        # A body that is compressed properly is read as usual.
        fine = await login("gzip", gzip.compress(b'{"email":"a@example.com","password":"x"}'))
        assert fine.status_code == 401

    async def test_login_failure_is_401_unauthenticated(self, api: httpx.AsyncClient, account: Account) -> None:
        res = await api.post("/api/auth/login", json={"email": account.user["email"], "password": "wrong-password"})
        assert res.status_code == 401
        assert res.json() == {"error": {"code": "UNAUTHENTICATED", "message": "Email or password is incorrect."}}

    @pytest.mark.parametrize(
        ("body", "field", "message"),
        [
            ({"name": "A", "email": "not-an-email", "password": "longenough"}, "email", "Enter a valid email address."),
            (
                {"name": "A", "email": "a@example.com", "password": "short"},
                "password",
                "Password must be at least 8 characters.",
            ),
        ],
    )
    async def test_register_rejects_bad_input_with_the_exact_message(
        self, api: httpx.AsyncClient, body: dict[str, str], field: str, message: str
    ) -> None:
        res = await api.post("/api/auth/register", json=body)
        assert res.status_code == 400
        assert res.json()["error"] == {"code": "VALIDATION_ERROR", "field": field, "message": message}


class TestResponses:
    async def test_users_have_only_the_documented_fields(self, api: httpx.AsyncClient, account: Account) -> None:
        me = await api.get("/api/auth/me", headers=account.headers)
        assert me.status_code == 200
        assert sorted(me.json()["user"]) == [
            "alerts",
            "currency",
            "email",
            "firstRunDone",
            "id",
            "mealReminders",
            "name",
            "notificationPreferences",
            "reminderDelivery",
            "savePhotos",
            "timeZone",
        ]


class TestRoutes:
    async def test_removed_routes_are_gone(self, api: httpx.AsyncClient, account: Account) -> None:
        assert (await api.get("/api/usage-records", headers=account.headers)).status_code == 404
        assert (await api.put("/api/notifications/read-all", headers=account.headers)).status_code == 404
