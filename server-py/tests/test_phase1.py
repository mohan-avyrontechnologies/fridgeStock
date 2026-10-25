"""Faster entry, and the fields added ahead of later phases (server/src/tests/phase1.test.ts). Its migration test
is in test_models.py; the other 15 need the food routes, so they arrived with Phase 2."""

from datetime import timedelta
from typing import Any

import httpx
import pytest
from bson import ObjectId

from server_py.models.food_item import FOOD_ITEM
from server_py.models.notification import NOTIFICATION
from server_py.models.usage_record import USAGE_RECORD
from server_py.models.user import USER
from server_py.services import clock
from tests.conftest import Account, food, register_user, set_today

pytestmark = pytest.mark.phase2


@pytest.fixture
async def s(api: httpx.AsyncClient) -> Account:
    set_today("2026-09-29")
    return await register_user(api)


@pytest.fixture
def create(api: httpx.AsyncClient, s: Account):
    async def make(**overrides: Any) -> dict[str, Any]:
        res = await api.post("/api/foods", headers=s.headers, json=food(**overrides))
        assert res.status_code == 201, res.text
        return res.json()

    return make


def matches(body: dict[str, Any], **expected: Any) -> bool:
    return {key: body.get(key) for key in expected} == expected


async def count(collection: Any, **query: Any) -> int:
    return await collection.count_documents(query)


class TestNewFields:
    async def test_every_user_gets_their_own_household_and_their_items_carry_it(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        other = await register_user(api)
        a = await USER.collection().find_one({"_id": ObjectId(s.user["id"])})
        b = await USER.collection().find_one({"_id": ObjectId(other.user["id"])})
        assert a is not None and b is not None  # noqa: PT018
        assert isinstance(a["householdId"], ObjectId)
        assert a["householdId"] != b["householdId"]
        item = await create()
        stored = await FOOD_ITEM.collection().find_one({"_id": ObjectId(item["id"])})
        assert stored is not None
        assert stored["householdId"] == a["householdId"]

    async def test_storage_defaults_to_fridge_and_accepts_freezer_and_pantry(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        assert (await create())["storage"] == "FRIDGE"
        assert (await create(storage="FREEZER"))["storage"] == "FREEZER"
        assert (await create(storage="PANTRY"))["storage"] == "PANTRY"
        bad = await api.post("/api/foods", headers=s.headers, json=food(storage="CELLAR"))
        assert bad.status_code == 400
        assert bad.json()["error"] == {
            "code": "VALIDATION_ERROR",
            "field": "storage",
            "message": "Choose where it is kept: fridge, freezer or pantry.",
        }

    async def test_opened_date_is_optional_and_not_in_the_future_or_before_added(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        assert (await create())["openedDate"] is None
        opened = await create(addedDate="2026-09-27", openedDate="2026-09-28")
        assert opened["openedDate"] == "2026-09-28"
        for opened_date in ["2026-09-30", "2026-09-26", "yesterday"]:
            res = await api.post(
                "/api/foods", headers=s.headers, json=food(addedDate="2026-09-27", openedDate=opened_date)
            )
            assert res.status_code == 400
            assert res.json()["error"]["field"] == "openedDate"

    async def test_storage_and_opened_date_can_be_edited_and_cleared(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create()
        edited = await api.put(
            f"/api/foods/{item['id']}", headers=s.headers, json={"storage": "FREEZER", "openedDate": "2026-09-29"}
        )
        assert matches(edited.json(), storage="FREEZER", openedDate="2026-09-29")
        cleared = await api.put(f"/api/foods/{item['id']}", headers=s.headers, json={"openedDate": None})
        assert cleared.json()["openedDate"] is None


HAUL: dict[str, Any] = {
    "addedDate": "2026-09-29",
    "items": [
        {"name": "Chicken", "quantity": 500, "unit": "g", "lifespanDays": 2},
        {"name": "Peas", "quantity": 1, "unit": "pack", "lifespanDays": 240, "storage": "FREEZER"},
        {"name": "Milk", "quantity": 2, "unit": "l", "lifespanDays": 5},
    ],
}


class TestBulkAdd:
    async def test_adds_a_whole_haul_with_a_shared_added_date_and_per_row_storage(
        self, api: httpx.AsyncClient, s: Account
    ) -> None:
        res = await api.post("/api/foods/bulk", headers=s.headers, json=HAUL)
        assert res.status_code == 201
        items = res.json()["items"]
        assert [[i["name"], i["storage"]] for i in items] == [
            ["Chicken", "FRIDGE"],
            ["Peas", "FREEZER"],
            ["Milk", "FRIDGE"],
        ]
        assert matches(items[0], addedDate="2026-09-29", expiryDate="2026-10-01", urgency="APPROACHING_EXPIRY")
        assert (await api.get("/api/foods", headers=s.headers)).json()["summary"]["total"] == 3

    async def test_schedules_reminders_for_every_item(self, api: httpx.AsyncClient, s: Account) -> None:
        res = await api.post("/api/foods/bulk", headers=s.headers, json=HAUL)
        for item in res.json()["items"]:
            assert await count(NOTIFICATION.collection(), foodId=ObjectId(item["id"])) > 0

    async def test_names_the_failing_row_and_field_and_saves_nothing(self, api: httpx.AsyncClient, s: Account) -> None:
        rows = HAUL["items"]
        bad = {**HAUL, "items": [rows[0], {**rows[1], "lifespanDays": 400}, rows[2]]}
        res = await api.post("/api/foods/bulk", headers=s.headers, json=bad)
        assert res.status_code == 400
        assert res.json()["error"] == {
            "code": "VALIDATION_ERROR",
            "field": "items.1.lifespanDays",
            "message": "Lifespan must be a whole number of days from 0 to 365.",
        }
        assert await count(FOOD_ITEM.collection(), userId=ObjectId(s.user["id"])) == 0

    async def test_needs_1_to_50_items_and_an_added_date_not_in_the_future(
        self, api: httpx.AsyncClient, s: Account
    ) -> None:
        empty = await api.post("/api/foods/bulk", headers=s.headers, json={**HAUL, "items": []})
        assert empty.status_code == 400
        assert empty.json()["error"]["message"] == "Add at least one item."
        many = await api.post("/api/foods/bulk", headers=s.headers, json={**HAUL, "items": [HAUL["items"][0]] * 51})
        assert many.status_code == 400
        assert many.json()["error"]["message"] == "Add at most 50 items at once."
        future = await api.post("/api/foods/bulk", headers=s.headers, json={**HAUL, "addedDate": "2026-10-01"})
        assert future.status_code == 400
        assert future.json()["error"]["field"] == "addedDate"


MILK: dict[str, Any] = {"name": "Milk", "quantity": 2, "unit": "l", "lifespanDays": 5}


class TestFavourites:
    async def test_saves_lists_alphabetically_and_rejects_a_duplicate_name(
        self, api: httpx.AsyncClient, s: Account
    ) -> None:
        spinach = await api.post(
            "/api/favourites", headers=s.headers, json={**MILK, "name": "Spinach", "unit": "bunch"}
        )
        assert spinach.status_code == 201
        created = await api.post("/api/favourites", headers=s.headers, json=MILK)
        assert created.status_code == 201
        assert matches(created.json(), **MILK, storage="FRIDGE")
        dup = await api.post("/api/favourites", headers=s.headers, json={**MILK, "name": "MILK"})
        assert dup.status_code == 409
        assert matches(dup.json()["error"], code="CONFLICT", message="This food is already a favourite.")
        listed = (await api.get("/api/favourites", headers=s.headers)).json()
        assert [f["name"] for f in listed["items"]] == ["Milk", "Spinach"]

    async def test_one_tap_re_adds_it_as_a_new_item_added_today(self, api: httpx.AsyncClient, s: Account) -> None:
        favourite = (await api.post("/api/favourites", headers=s.headers, json={**MILK, "storage": "FREEZER"})).json()
        res = await api.post(f"/api/favourites/{favourite['id']}/add", headers=s.headers)
        assert res.status_code == 201
        assert matches(
            res.json(),
            name="Milk",
            quantity=2,
            unit="l",
            lifespanDays=5,
            storage="FREEZER",
            addedDate="2026-09-29",
            expiryDate="2026-10-04",
            status="ACTIVE",
        )

    async def test_can_be_deleted_and_is_private_to_its_owner(self, api: httpx.AsyncClient, s: Account) -> None:
        favourite = (await api.post("/api/favourites", headers=s.headers, json=MILK)).json()
        other = await register_user(api)
        assert (await api.get("/api/favourites", headers=other.headers)).json()["items"] == []
        assert (await api.post(f"/api/favourites/{favourite['id']}/add", headers=other.headers)).status_code == 404
        assert (await api.delete(f"/api/favourites/{favourite['id']}", headers=other.headers)).status_code == 404
        assert (await api.delete(f"/api/favourites/{favourite['id']}", headers=s.headers)).status_code == 204
        assert (await api.get("/api/favourites", headers=s.headers)).json()["items"] == []


class TestUndo:
    @pytest.mark.parametrize(
        ("method", "suffix"), [("POST", "/use"), ("POST", "/waste"), ("DELETE", "")], ids=["used", "wasted", "removed"]
    )
    async def test_undoing_reopens_the_item_with_its_quantity_and_reminders(
        self, api: httpx.AsyncClient, s: Account, create: Any, method: str, suffix: str
    ) -> None:
        item = await create(quantity=3, unit="pcs", lifespanDays=10)
        food_id = ObjectId(item["id"])
        await api.request(
            method, f"/api/foods/{item['id']}{suffix}", headers=s.headers, json={} if method == "POST" else None
        )
        assert await count(NOTIFICATION.collection(), foodId=food_id, status="PENDING") == 0
        res = await api.post(f"/api/foods/{item['id']}/undo", headers=s.headers)
        assert res.status_code == 200
        assert matches(res.json(), status="ACTIVE", quantity=3, closedAt=None, urgency="NOT_URGENT")
        assert await count(USAGE_RECORD.collection(), foodId=food_id) == 0
        assert await count(NOTIFICATION.collection(), foodId=food_id, status="PENDING") == 3
        assert [i["id"] for i in (await api.get("/api/foods", headers=s.headers)).json()["items"]] == [item["id"]]
        stored = await FOOD_ITEM.collection().find_one({"_id": food_id})
        assert stored is not None
        assert "closedAt" not in stored

    async def test_undoing_a_partial_use_gives_the_quantity_back_step_by_step(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(quantity=1, unit="kg")
        url = f"/api/foods/{item['id']}"
        await api.post(f"{url}/use", headers=s.headers, json={"quantity": 0.3})
        await api.post(f"{url}/use", headers=s.headers, json={"quantity": 0.2})
        assert (await api.post(f"{url}/undo", headers=s.headers)).json()["quantity"] == 0.7
        assert (await api.post(f"{url}/undo", headers=s.headers)).json()["quantity"] == 1
        assert (await api.post(f"{url}/undo", headers=s.headers)).status_code == 409

    async def test_409_when_there_is_nothing_to_undo_or_after_10_minutes(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create()
        url = f"/api/foods/{item['id']}"
        none = await api.post(f"{url}/undo", headers=s.headers)
        assert none.status_code == 409
        assert none.json()["error"] == {"code": "CONFLICT", "message": "There is nothing to undo for this item."}
        await api.post(f"{url}/waste", headers=s.headers, json={})
        clock.set(clock.now() + timedelta(minutes=11))
        late = await api.post(f"{url}/undo", headers=s.headers)
        assert late.status_code == 409
        assert late.json()["error"]["message"] == "This action can no longer be undone."

    async def test_another_user_cant_undo_your_actions(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        item = await create()
        await api.post(f"/api/foods/{item['id']}/waste", headers=s.headers, json={})
        other = await register_user(api)
        assert (await api.post(f"/api/foods/{item['id']}/undo", headers=other.headers)).status_code == 404
