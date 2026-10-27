"""Food items: adding, limits, listing, editing and usage actions (server/src/tests/foods.test.ts, all 26 tests)."""

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from bson import ObjectId

from server_py.models.food_item import FOOD_ITEM
from server_py.models.usage_record import USAGE_RECORD
from server_py.services import clock
from tests.conftest import UNDEFINED, Account, food, register_user, set_today

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


class TestAddingFood:
    async def test_calculates_expected_expiry_as_added_date_plus_lifespan(self, create: Any) -> None:
        body = await create(addedDate="2026-09-27", lifespanDays=5)
        assert (
            body
            | {
                "name": "Milk",
                "quantity": 1,
                "unit": "l",
                "addedDate": "2026-09-27",
                "lifespanDays": 5,
                "expiryDate": "2026-10-02",
                "status": "ACTIVE",
                "remainingDays": 3,
                "urgency": "APPROACHING_EXPIRY",
            }
            == body
        )

    async def test_accepts_a_zero_day_lifespan_as_expected_expiry_today(self, create: Any) -> None:
        body = await create(lifespanDays=0)
        assert (body["expiryDate"], body["remainingDays"], body["urgency"]) == ("2026-09-29", 0, "DUE")

    async def test_allows_a_backdated_added_date_already_past_expected_expiry(self, create: Any) -> None:
        body = await create(addedDate="2026-09-20", lifespanDays=2)
        assert (body["remainingDays"], body["urgency"]) == (-7, "OVERDUE")

    @pytest.mark.parametrize(
        ("overrides", "field", "message"),
        [
            ({"name": "   "}, "name", "Food name is required."),
            ({"name": UNDEFINED}, "name", "Food name is required."),
            ({"quantity": 0}, "quantity", "Quantity must be a positive number."),
            ({"quantity": -2}, "quantity", "Quantity must be a positive number."),
            ({"quantity": "lots"}, "quantity", "Quantity must be a positive number."),
            ({"unit": ""}, "unit", "Choose a unit from the list."),
            ({"unit": "cups"}, "unit", "Choose a unit from the list."),
            ({"name": "x" * 61}, "name", "Food name must be at most 60 characters."),
            ({"lifespanDays": 366}, "lifespanDays", "Lifespan must be a whole number of days from 0 to 365."),
            ({"lifespanDays": -1}, "lifespanDays", "Lifespan must be a whole number of days from 0 to 365."),
            ({"lifespanDays": 2.5}, "lifespanDays", "Lifespan must be a whole number of days from 0 to 365."),
            ({"lifespanDays": "three"}, "lifespanDays", "Lifespan must be a whole number of days from 0 to 365."),
            ({"notes": "n" * 201}, "notes", "Notes must be at most 200 characters."),
            ({"addedDate": "yesterday"}, "addedDate", "Added date must be a valid date that isn't in the future."),
            ({"addedDate": "2026-02-30"}, "addedDate", "Added date must be a valid date that isn't in the future."),
            ({"addedDate": "2026-09-30"}, "addedDate", "Added date must be a valid date that isn't in the future."),
        ],
    )
    async def test_rejects(
        self, api: httpx.AsyncClient, s: Account, overrides: dict[str, Any], field: str, message: str
    ) -> None:
        res = await api.post("/api/foods", headers=s.headers, json=food(**overrides))
        assert res.status_code == 400
        assert res.json()["error"] == {"code": "VALIDATION_ERROR", "field": field, "message": message}

    async def test_ignores_a_user_id_in_the_request_body(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        other = await register_user(api)
        body = await create(userId=other.user["id"])
        assert (await api.get(f"/api/foods/{body['id']}", headers=other.headers)).status_code == 404
        assert (await api.get(f"/api/foods/{body['id']}", headers=s.headers)).status_code == 200


class TestLimitsUnitsAndNotes:
    async def test_accepts_the_boundaries(self, create: Any) -> None:
        for unit in ["pcs", "g", "kg", "ml", "l", "pack", "bunch"]:
            await create(unit=unit)
        body = await create(name="x" * 60, lifespanDays=365, notes="n" * 200)
        assert (body["lifespanDays"], body["expiryDate"], body["notes"]) == (365, "2027-09-29", "n" * 200)

    async def test_stores_notes_returns_null_without_and_clears_with_empty(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        with_notes = await create(notes="  Top shelf, opened  ")
        assert with_notes["notes"] == "Top shelf, opened"
        assert (await create())["notes"] is None
        cleared = await api.put(f"/api/foods/{with_notes['id']}", headers=s.headers, json={"notes": ""})
        assert cleared.status_code == 200
        assert cleared.json()["notes"] is None


class TestExpiryDateIsAlwaysCalculatedByTheServer:
    async def test_ignores_an_expiry_date_sent_when_creating(self, create: Any) -> None:
        body = await create(addedDate="2026-09-28", lifespanDays=2, expiryDate="2030-01-01", remainingDays=99)
        assert body["expiryDate"] == "2026-09-30"
        stored = await FOOD_ITEM.collection().find_one({"_id": ObjectId(body["id"])})
        assert stored is not None
        assert stored["expiryDate"] == "2026-09-30"

    async def test_ignores_an_expiry_date_when_editing_and_recalculates(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(lifespanDays=2)
        res = await api.put(
            f"/api/foods/{item['id']}", headers=s.headers, json={"expiryDate": "2030-01-01", "lifespanDays": 5}
        )
        assert res.json()["expiryDate"] == "2026-10-04"

    async def test_keeps_the_expiry_date_when_only_other_fields_change(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(lifespanDays=2)
        res = await api.put(
            f"/api/foods/{item['id']}", headers=s.headers, json={"name": "Oat milk", "expiryDate": "2030-01-01"}
        )
        assert (res.json()["name"], res.json()["expiryDate"]) == ("Oat milk", "2026-10-01")


class TestListingAndFridgeStock:
    async def test_sorts_by_expected_expiry_and_fridge_stock_excludes_not_urgent(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        await create(name="Eggs", lifespanDays=8)
        await create(name="Milk", lifespanDays=4)
        await create(name="Chicken", lifespanDays=1)
        await create(name="Spinach", lifespanDays=2)
        await create(name="Bread", addedDate="2026-09-25", lifespanDays=3)
        await create(name="Yoghurt", lifespanDays=0)
        listed = (await api.get("/api/foods", headers=s.headers)).json()
        assert listed["today"] == "2026-09-29"
        assert [i["name"] for i in listed["items"]] == ["Bread", "Yoghurt", "Chicken", "Spinach", "Milk", "Eggs"]
        assert listed["summary"] == {"NOT_URGENT": 2, "APPROACHING_EXPIRY": 2, "DUE": 1, "OVERDUE": 1, "total": 6}
        fridge_stock = (await api.get("/api/foods/fridgestock", headers=s.headers)).json()
        assert [i["name"] for i in fridge_stock["items"]] == ["Bread", "Yoghurt", "Chicken", "Spinach"]

    async def test_recalculates_remaining_days_as_the_date_moves_on(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(lifespanDays=4)
        set_today("2026-10-02")
        res = (await api.get(f"/api/foods/{item['id']}", headers=s.headers)).json()
        assert (res["remainingDays"], res["urgency"]) == (1, "APPROACHING_EXPIRY")
        set_today("2026-10-04")
        later = (await api.get(f"/api/foods/{item['id']}", headers=s.headers)).json()
        assert (later["remainingDays"], later["urgency"]) == (-1, "OVERDUE")

    async def test_uses_the_users_own_time_zone_to_decide_today(self, api: httpx.AsyncClient, s: Account) -> None:
        tokyo = await register_user(api, timeZone="Asia/Tokyo")
        # 20:00 UTC on 29 Sep is already 30 Sep in Tokyo.
        clock.set(datetime(2026, 9, 29, 20, tzinfo=UTC))
        res = await api.post("/api/foods", headers=tokyo.headers, json=food(addedDate="2026-09-30", lifespanDays=1))
        assert res.status_code == 201
        assert res.json()["remainingDays"] == 1


class TestEditing:
    async def test_recalculates_expected_expiry_when_lifespan_changes(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(lifespanDays=4)
        res = (await api.put(f"/api/foods/{item['id']}", headers=s.headers, json={"lifespanDays": 10})).json()
        assert (res["expiryDate"], res["remainingDays"], res["urgency"]) == ("2026-10-09", 10, "NOT_URGENT")

    async def test_recalculates_expected_expiry_when_added_date_changes(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(lifespanDays=4)
        res = (await api.put(f"/api/foods/{item['id']}", headers=s.headers, json={"addedDate": "2026-09-24"})).json()
        assert (res["expiryDate"], res["urgency"]) == ("2026-09-28", "OVERDUE")

    async def test_validates_updates_and_requires_at_least_one_field(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create()
        assert (await api.put(f"/api/foods/{item['id']}", headers=s.headers, json={"quantity": -1})).status_code == 400
        empty = await api.put(f"/api/foods/{item['id']}", headers=s.headers, json={})
        assert empty.status_code == 400
        assert empty.json()["error"] == {"code": "VALIDATION_ERROR", "message": "Provide at least one field to update."}

    async def test_returns_404_for_unknown_and_malformed_ids(self, api: httpx.AsyncClient, s: Account) -> None:
        assert (await api.get("/api/foods/000000000000000000000000", headers=s.headers)).status_code == 404
        assert (await api.get("/api/foods/not-an-id", headers=s.headers)).status_code == 404


class TestUsageActions:
    async def test_use_without_a_quantity_uses_the_whole_item(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(quantity=2, lifespanDays=1)
        res = (await api.post(f"/api/foods/{item['id']}/use", headers=s.headers, json={})).json()
        assert (res["food"]["status"], res["food"]["remainingDays"], res["food"]["urgency"]) == ("USED", None, None)
        assert isinstance(res["food"]["closedAt"], str)
        record = res["usageRecord"]
        assert (record["action"], record["quantityUsed"], record["unit"], record["date"]) == (
            "USED",
            2,
            "l",
            "2026-09-29",
        )
        assert (await api.get("/api/foods", headers=s.headers)).json()["items"] == []
        assert (await api.get("/api/foods/fridgestock", headers=s.headers)).json()["items"] == []

    @pytest.mark.parametrize(
        ("method", "suffix"),
        [("POST", "/use"), ("POST", "/waste"), ("DELETE", "")],
        ids=["used", "wasted", "removed"],
    )
    async def test_a_closed_item_disappears_from_the_inventory_and_fridge_stock(
        self, api: httpx.AsyncClient, s: Account, create: Any, method: str, suffix: str
    ) -> None:
        kept = await create(name="Kept", lifespanDays=1)
        gone = await create(name="Gone", lifespanDays=1)
        body: dict[str, Any] | None = {} if method == "POST" else None
        await api.request(method, f"/api/foods/{gone['id']}{suffix}", headers=s.headers, json=body)
        listed = (await api.get("/api/foods", headers=s.headers)).json()
        fridge_stock = (await api.get("/api/foods/fridgestock", headers=s.headers)).json()
        assert [i["id"] for i in listed["items"]] == [kept["id"]]
        assert [i["id"] for i in fridge_stock["items"]] == [kept["id"]]
        assert listed["summary"]["total"] == 1

    async def test_use_with_the_whole_quantity_also_closes_the_item(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(quantity=3, unit="pcs")
        res = (await api.post(f"/api/foods/{item['id']}/use", headers=s.headers, json={"quantity": 3})).json()
        assert (res["food"]["status"], res["usageRecord"]["action"]) == ("USED", "USED")

    async def test_use_with_a_smaller_quantity_logs_partially_used(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(quantity=1, unit="kg")
        res = (await api.post(f"/api/foods/{item['id']}/use", headers=s.headers, json={"quantity": 0.3})).json()
        assert (res["food"]["status"], res["food"]["quantity"], res["food"]["closedAt"]) == ("ACTIVE", 0.7, None)
        record = res["usageRecord"]
        assert (record["action"], record["quantityUsed"], record["quantityRemaining"], record["unit"]) == (
            "PARTIALLY_USED",
            0.3,
            0.7,
            "kg",
        )

    @pytest.mark.parametrize(
        ("quantity", "message"),
        [
            (0, "Quantity must be a positive number."),
            (-1, "Quantity must be a positive number."),
            (5, "There is only 1 l left."),
        ],
    )
    async def test_use_rejects_a_bad_quantity(
        self, api: httpx.AsyncClient, s: Account, create: Any, quantity: int, message: str
    ) -> None:
        item = await create(quantity=1)
        res = await api.post(f"/api/foods/{item['id']}/use", headers=s.headers, json={"quantity": quantity})
        assert res.status_code == 400
        assert res.json()["error"] == {"code": "VALIDATION_ERROR", "field": "quantity", "message": message}

    async def test_waste_closes_the_whole_item_and_logs_the_quantity_left(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(quantity=4, unit="pcs")
        await api.post(f"/api/foods/{item['id']}/use", headers=s.headers, json={"quantity": 1})
        res = (await api.post(f"/api/foods/{item['id']}/waste", headers=s.headers, json={"quantity": 1})).json()
        assert res["food"]["status"] == "WASTED"
        assert isinstance(res["food"]["closedAt"], str)
        record = res["usageRecord"]
        assert (record["action"], record["quantityUsed"], record["unit"]) == ("WASTED", 3, "pcs")

    async def test_delete_soft_deletes_the_item_as_removed(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(quantity=2)
        assert (await api.delete(f"/api/foods/{item['id']}", headers=s.headers)).status_code == 204
        res = (await api.get(f"/api/foods/{item['id']}", headers=s.headers)).json()
        assert (res["status"], res["remainingDays"]) == ("REMOVED", None)
        assert isinstance(res["closedAt"], str)
        record = await USAGE_RECORD.collection().find_one({"foodId": ObjectId(item["id"]), "action": "REMOVED"})
        assert record is not None
        assert record["quantityUsed"] == 2

    async def test_any_action_on_a_closed_item_is_409(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        item = await create()
        await api.post(f"/api/foods/{item['id']}/use", headers=s.headers, json={})
        for method, suffix, body in [
            ("POST", "/use", {}),
            ("POST", "/waste", {}),
            ("DELETE", "", None),
            ("PUT", "", {"name": "x"}),
        ]:
            res = await api.request(method, f"/api/foods/{item['id']}{suffix}", headers=s.headers, json=body)
            assert res.status_code == 409
            assert res.json()["error"] == {"code": "CONFLICT", "message": "This item is no longer active."}

    async def test_usage_lists_history_newest_first_with_paging(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        a = await create(name="A", quantity=2)
        b = await create(name="B")
        c = await create(name="C")
        await api.post(f"/api/foods/{a['id']}/use", headers=s.headers, json={"quantity": 1})
        await api.post(f"/api/foods/{b['id']}/waste", headers=s.headers, json={})
        await api.delete(f"/api/foods/{c['id']}", headers=s.headers)

        everything = (await api.get("/api/usage", headers=s.headers)).json()
        assert [r["foodName"] for r in everything["items"]] == ["C", "B", "A"]
        assert everything["counts"] == {"USED": 0, "PARTIALLY_USED": 1, "WASTED": 1, "REMOVED": 1}

        page = (await api.get("/api/usage?limit=2&offset=1", headers=s.headers)).json()
        assert page["total"] == 3
        assert [r["foodName"] for r in page["items"]] == ["B", "A"]

        for i in range(22):
            made = await create(name=f"bulk{i}")
            await api.delete(f"/api/foods/{made['id']}", headers=s.headers)
        assert len((await api.get("/api/usage", headers=s.headers)).json()["items"]) == 20
