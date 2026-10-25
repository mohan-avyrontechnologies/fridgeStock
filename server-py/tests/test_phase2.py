"""Realistic estimates: opening, moving and learned lifespans (server/src/tests/phase2.test.ts, all 17 tests)."""

from typing import Any

import httpx
import pytest
from bson import ObjectId

from server_py.models.food_item import FOOD_ITEM
from server_py.models.migrations import run_migrations
from server_py.models.notification import NOTIFICATION
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


async def pending_dates(food_id: str) -> set[str]:
    cursor = NOTIFICATION.collection().find({"foodId": ObjectId(food_id), "status": "PENDING"})
    return {n["expiryDate"] async for n in cursor}


def matches(body: dict[str, Any], **expected: Any) -> bool:
    return {key: body.get(key) for key in expected} == expected


class TestOpenedShortensTheExpectedExpiry:
    async def test_milk_opened_today_lasts_4_more_days(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        item = await create(name="Milk", lifespanDays=10)  # expires 10-09
        res = (await api.post(f"/api/foods/{item['id']}/open", headers=s.headers, json={})).json()
        assert matches(
            res,
            openedDate="2026-09-29",
            expiryDate="2026-10-03",
            lifespanDays=4,
            remainingDays=4,
            urgency="NOT_URGENT",
        )
        # Reminders follow the new expected expiry.
        assert await pending_dates(item["id"]) == {"2026-10-03"}

    async def test_never_lengthens_it(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        item = await create(name="Milk", lifespanDays=2)  # expires 10-01
        res = (await api.post(f"/api/foods/{item['id']}/open", headers=s.headers, json={"daysLeft": 5})).json()
        assert matches(res, openedDate="2026-09-29", expiryDate="2026-10-01", lifespanDays=2)

    async def test_accepts_a_past_opened_date_and_a_custom_number_of_days(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(name="Pickles", addedDate="2026-09-20", lifespanDays=60)
        res = await api.post(
            f"/api/foods/{item['id']}/open", headers=s.headers, json={"openedDate": "2026-09-25", "daysLeft": 3}
        )
        assert matches(res.json(), openedDate="2026-09-25", expiryDate="2026-09-28", urgency="OVERDUE")

    async def test_a_food_with_no_once_opened_value_keeps_its_expected_expiry(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(name="Pickles")
        res = (await api.post(f"/api/foods/{item['id']}/open", headers=s.headers, json={})).json()
        assert matches(res, openedDate="2026-09-29", expiryDate=item["expiryDate"])

    async def test_rejects_a_second_opened_bad_dates_and_closed_items(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(name="Milk", addedDate="2026-09-27")
        url = f"/api/foods/{item['id']}/open"
        assert (await api.post(url, headers=s.headers, json={"openedDate": "2026-09-30"})).status_code == 400
        assert (await api.post(url, headers=s.headers, json={"openedDate": "2026-09-26"})).status_code == 400
        assert (await api.post(url, headers=s.headers, json={})).status_code == 200
        again = await api.post(url, headers=s.headers, json={})
        assert again.status_code == 409
        assert again.json()["error"]["message"] == "This item is already marked as opened."
        other = await create(name="Cream")
        await api.post(f"/api/foods/{other['id']}/use", headers=s.headers, json={})
        assert (await api.post(f"/api/foods/{other['id']}/open", headers=s.headers, json={})).status_code == 409

    async def test_can_be_undone(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        item = await create(name="Milk", lifespanDays=10)
        await api.post(f"/api/foods/{item['id']}/open", headers=s.headers, json={})
        res = (await api.delete(f"/api/foods/{item['id']}/open", headers=s.headers)).json()
        assert matches(res, openedDate=None, lifespanDays=10, expiryDate="2026-10-09")
        assert await pending_dates(item["id"]) == {"2026-10-09"}
        none = await api.delete(f"/api/foods/{item['id']}/open", headers=s.headers)
        assert none.status_code == 409
        assert none.json()["error"]["message"] == "This item is not marked as opened."


class TestMoving:
    async def test_to_the_freezer_without_a_number_never_extends_it(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(name="Chicken", unit="g", addedDate="2026-09-28", lifespanDays=2)
        res = (await api.post(f"/api/foods/{item['id']}/move", headers=s.headers, json={"storage": "FREEZER"})).json()
        assert matches(res, storage="FREEZER", expiryDate="2026-09-30", lifespanDays=2)

    async def test_with_days_chosen_counts_from_today(self, api: httpx.AsyncClient, s: Account, create: Any) -> None:
        item = await create(name="Chicken", unit="g", addedDate="2026-09-28", lifespanDays=2)
        res = await api.post(
            f"/api/foods/{item['id']}/move", headers=s.headers, json={"storage": "FREEZER", "daysLeft": 270}
        )
        # 270 days from today (09-29) is 2027-06-26; the lifespan counts from the added date (09-28).
        assert matches(
            res.json(),
            expirySource="USER",
            storage="FREEZER",
            expiryDate="2027-06-26",
            lifespanDays=271,
            remainingDays=270,
            urgency="NOT_URGENT",
        )
        assert await pending_dates(item["id"]) == {"2027-06-26"}

    async def test_moving_back_to_the_fridge_shortens_it_again(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(name="Chicken", lifespanDays=2)
        url = f"/api/foods/{item['id']}/move"
        await api.post(url, headers=s.headers, json={"storage": "FREEZER", "daysLeft": 270})
        res = (await api.post(url, headers=s.headers, json={"storage": "FRIDGE"})).json()
        assert matches(res, storage="FRIDGE", expiryDate="2026-10-01", remainingDays=2)

    async def test_accepts_a_custom_number_of_days_and_caps_the_lifespan(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        custom = await create(name="Soup", lifespanDays=3)
        a = await api.post(
            f"/api/foods/{custom['id']}/move", headers=s.headers, json={"storage": "FREEZER", "daysLeft": 30}
        )
        assert matches(a.json(), expiryDate="2026-10-29", lifespanDays=30)
        old = await create(name="Broccoli", addedDate="2026-06-01", lifespanDays=200)
        b = await api.post(
            f"/api/foods/{old['id']}/move", headers=s.headers, json={"storage": "FREEZER", "daysLeft": 365}
        )
        assert matches(b.json(), lifespanDays=365, expiryDate="2027-06-01")

    async def test_estimates_without_days_and_rejects_the_same_place(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        eggs = await create(name="Eggs")  # eggs have no freezer value
        url = f"/api/foods/{eggs['id']}/move"
        moved = await api.post(url, headers=s.headers, json={"storage": "FREEZER"})
        assert matches(moved.json(), storage="FREEZER", expiryDate=eggs["expiryDate"])
        same = await api.post(url, headers=s.headers, json={"storage": "FREEZER"})
        assert same.status_code == 400
        assert matches(same.json()["error"], field="storage", message="It is already kept there.")
        assert (await api.post(url, headers=s.headers, json={"storage": "FREEZER", "daysLeft": 400})).status_code == 400

    async def test_another_user_cant_open_or_move_your_item(
        self, api: httpx.AsyncClient, s: Account, create: Any
    ) -> None:
        item = await create(name="Milk")
        other = await register_user(api)
        assert (await api.post(f"/api/foods/{item['id']}/open", headers=other.headers, json={})).status_code == 404
        assert (await api.delete(f"/api/foods/{item['id']}/open", headers=other.headers)).status_code == 404
        moved = await api.post(f"/api/foods/{item['id']}/move", headers=other.headers, json={"storage": "FREEZER"})
        assert moved.status_code == 404


class TestLearnedLifespans:
    @pytest.fixture
    def learned(self, api: httpx.AsyncClient, s: Account):
        async def read() -> list[dict[str, Any]]:
            res = await api.get("/api/suggestions/lifespans", headers=s.headers)
            assert res.status_code == 200
            return res.json()["items"]

        return read

    async def test_the_median_for_a_food_and_place_once_there_are_2(self, create: Any, learned: Any) -> None:
        await create(name="Spinach", unit="bunch", lifespanDays=3)
        assert await learned() == []
        await create(name="spinach", unit="bunch", lifespanDays=5)
        await create(name="Spinach", unit="bunch", lifespanDays=4)
        await create(name="Spinach", unit="bunch", lifespanDays=100, storage="FREEZER")
        assert await learned() == [{"name": "Spinach", "storage": "FRIDGE", "unit": "bunch", "days": 4, "basedOn": 3}]

    async def test_learns_from_closed_items_and_from_what_was_entered(
        self, api: httpx.AsyncClient, s: Account, create: Any, learned: Any
    ) -> None:
        a = await create(name="Milk", lifespanDays=7)
        b = await create(name="Milk", lifespanDays=7)
        await api.post(f"/api/foods/{a['id']}/open", headers=s.headers, json={})  # lifespan becomes 4
        await api.post(f"/api/foods/{b['id']}/move", headers=s.headers, json={"storage": "FREEZER"})
        await api.post(f"/api/foods/{a['id']}/use", headers=s.headers, json={})
        assert await learned() == [{"name": "Milk", "storage": "FRIDGE", "unit": "l", "days": 7, "basedOn": 2}]

    async def test_uses_only_the_last_10_items_and_editing_counts(
        self, api: httpx.AsyncClient, s: Account, create: Any, learned: Any
    ) -> None:
        for _ in range(10):
            await create(name="Bread", unit="pack", lifespanDays=3)
        edited = await create(name="Bread", unit="pack", lifespanDays=3)
        await api.put(f"/api/foods/{edited['id']}", headers=s.headers, json={"lifespanDays": 9})
        [bread] = await learned()
        assert (bread["days"], bread["basedOn"]) == (3, 10)

    async def test_is_private(self, api: httpx.AsyncClient, learned: Any) -> None:
        other = await register_user(api)
        for _ in range(3):
            await api.post("/api/foods", headers=other.headers, json=food(name="Kale", lifespanDays=9))
        assert await learned() == []

    async def test_existing_items_are_backfilled_with_what_was_entered(self, create: Any) -> None:
        item = await create(name="Old")
        await FOOD_ITEM.collection().update_one(
            {"_id": ObjectId(item["id"])}, {"$unset": {"enteredLifespanDays": "", "enteredStorage": ""}}
        )
        await run_migrations()
        raw = await FOOD_ITEM.collection().find_one({"name": "Old"})
        assert raw is not None
        assert (raw["enteredLifespanDays"], raw["enteredStorage"]) == (4, "FRIDGE")
