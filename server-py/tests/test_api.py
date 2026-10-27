"""The API contract: error format and response shapes (server/src/tests/api.test.ts, all 14 tests)."""

import gzip
import json
from typing import Any, get_args

import httpx
import pytest
from bson import ObjectId
from starlette.requests import Request
from starlette.responses import Response

from server_py.models import food_item
from server_py.models.notification import NOTIFICATION
from server_py.routes.router import run_steps
from server_py.services import food_service
from server_py.services.errors import ErrorCode
from tests.conftest import Account, food, register_user, set_today

ERROR_CODES = get_args(ErrorCode)


@pytest.fixture
async def account(api: httpx.AsyncClient) -> Account:
    set_today("2026-09-29")
    return await register_user(api)


@pytest.mark.phase1
class TestErrors:
    @pytest.mark.phase2
    async def test_every_error_has_a_known_code_and_a_message_and_never_a_stack_trace(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        responses = [
            await api.get("/api/foods"),  # 401
            await api.get("/api/foods/000000000000000000000000", headers=account.headers),  # 404
            await api.post("/api/foods", headers=account.headers, json={}),  # 400
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

    @pytest.mark.phase2
    async def test_an_unexpected_failure_is_500_internal_with_a_generic_message(
        self, api: httpx.AsyncClient, account: Account, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom(*_args: object) -> None:
            raise RuntimeError("boom at secret.py:12")

        monkeypatch.setattr(food_service, "list_foods", boom)
        res = await api.get("/api/foods", headers=account.headers)
        assert res.status_code == 500
        assert res.json() == {"error": {"code": "INTERNAL", "message": "Something went wrong. Please try again."}}

    @pytest.mark.phase2
    async def test_a_database_validation_error_is_400_validation_error_not_500(self) -> None:
        async def invalid(_request: Request) -> Response | None:
            food_item.check_new({"unit": "cups"})
            return None

        res = await run_steps(Request({"type": "http", "headers": []}), [invalid])
        assert res.status_code == 400
        body: dict[str, Any] = json.loads(bytes(res.body))
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert isinstance(body["error"]["field"], str)

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
    @pytest.mark.phase1
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

    @pytest.mark.phase2
    async def test_food_items_have_their_stored_fields_plus_remaining_days_and_urgency(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        res = await api.post("/api/foods", headers=account.headers, json=food(notes="Top shelf"))
        assert res.status_code == 201
        expected = {
            "name": "Milk",
            "quantity": 1,
            "unit": "l",
            "addedDate": "2026-09-29",
            "lifespanDays": 4,
            "expiryDate": "2026-10-03",
            "notes": "Top shelf",
            "status": "ACTIVE",
            "closedAt": None,
            "remainingDays": 4,
            "urgency": "NOT_URGENT",
        }
        assert {key: res.json()[key] for key in expected} == expected
        assert "passwordHash" not in res.json()

    @pytest.mark.phase2
    async def test_get_foods_returns_active_items_in_priority_order_with_the_summary(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        await api.post("/api/foods", headers=account.headers, json=food(name="Later", lifespanDays=9))
        await api.post("/api/foods", headers=account.headers, json=food(name="Sooner", lifespanDays=1))
        res = (await api.get("/api/foods", headers=account.headers)).json()
        assert [i["name"] for i in res["items"]] == ["Sooner", "Later"]
        assert res["summary"] == {"NOT_URGENT": 1, "APPROACHING_EXPIRY": 1, "DUE": 0, "OVERDUE": 0, "total": 2}


async def _reminder_ids(food_id: str) -> list[str]:
    cursor = NOTIFICATION.collection().find({"foodId": ObjectId(food_id)}).sort("_id", 1)
    return [str(n["_id"]) async for n in cursor]


@pytest.mark.phase2
class TestRoutes:
    async def test_fridge_stock_is_matched_before_foods_id(self, api: httpx.AsyncClient, account: Account) -> None:
        res = await api.get("/api/foods/fridgestock", headers=account.headers)
        assert res.status_code == 200
        assert "items" in res.json()

    async def test_post_foods_returns_201_and_schedules_the_reminders(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        res = await api.post("/api/foods", headers=account.headers, json=food(lifespanDays=10))
        assert res.status_code == 201
        pending = {"foodId": ObjectId(res.json()["id"]), "status": "PENDING"}
        assert await NOTIFICATION.collection().count_documents(pending) == 3

    async def test_put_reschedules_reminders_only_when_the_dates_change(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        body = (await api.post("/api/foods", headers=account.headers, json=food(lifespanDays=10))).json()
        before = await _reminder_ids(body["id"])
        await api.put(f"/api/foods/{body['id']}", headers=account.headers, json={"name": "Oat milk", "notes": "x"})
        assert await _reminder_ids(body["id"]) == before
        await api.put(f"/api/foods/{body['id']}", headers=account.headers, json={"lifespanDays": 6})
        cursor = NOTIFICATION.collection().find({"foodId": ObjectId(body["id"]), "status": "PENDING"})
        assert [n["expiryDate"] async for n in cursor] == ["2026-10-05", "2026-10-05", "2026-10-05"]

    async def test_closing_an_item_deletes_its_pending_reminders(
        self, api: httpx.AsyncClient, account: Account
    ) -> None:
        body = (await api.post("/api/foods", headers=account.headers, json=food(lifespanDays=10))).json()
        await api.post(f"/api/foods/{body['id']}/waste", headers=account.headers, json={})
        pending = {"foodId": ObjectId(body["id"]), "status": "PENDING"}
        assert await NOTIFICATION.collection().count_documents(pending) == 0

    @pytest.mark.phase1
    async def test_removed_routes_are_gone(self, api: httpx.AsyncClient, account: Account) -> None:
        assert (await api.get("/api/usage-records", headers=account.headers)).status_code == 404
        assert (await api.put("/api/notifications/read-all", headers=account.headers)).status_code == 404
