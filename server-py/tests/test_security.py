"""Cross-user isolation (server/src/tests/security.test.ts). The route walk is in test_structure.py.

Ported here: everything about food, history and favourites. Still to come: the reminder feed in the first test
and "marking all as read" (Phase 4, when /notifications arrives), and "cannot plan a meal with another
household's food" (Phase 6).
"""

import httpx
import pytest
from bson import ObjectId

from server_py.models.food_item import FOOD_ITEM
from tests.conftest import Account, food, register_user, set_today

pytestmark = pytest.mark.phase2


@pytest.fixture
async def people(api: httpx.AsyncClient) -> tuple[Account, Account, str]:
    """Alice, Bob, and an item of Alice's she has partly used."""
    set_today("2026-09-29")
    alice = await register_user(api)
    bob = await register_user(api)
    res = await api.post("/api/foods", headers=alice.headers, json=food(lifespanDays=1))
    food_id: str = res.json()["id"]
    await api.post(f"/api/foods/{food_id}/use", headers=alice.headers, json={"quantity": 0.5})
    return alice, bob, food_id


async def stored(food_id: str) -> dict[str, object]:
    found = await FOOD_ITEM.collection().find_one({"_id": ObjectId(food_id)})
    assert found is not None
    return found


async def test_never_lists_another_users_food_cook_first_items_or_history(
    api: httpx.AsyncClient, people: tuple[Account, Account, str]
) -> None:
    _alice, bob, _food_id = people
    assert (await api.get("/api/foods", headers=bob.headers)).json()["items"] == []
    assert (await api.get("/api/foods/cook-first", headers=bob.headers)).json()["items"] == []
    assert (await api.get("/api/usage", headers=bob.headers)).json()["total"] == 0


async def test_cannot_read_edit_use_waste_or_remove_another_users_item(
    api: httpx.AsyncClient, people: tuple[Account, Account, str]
) -> None:
    _alice, bob, food_id = people
    for method, suffix, body in [
        ("GET", "", None),
        ("PUT", "", {"name": "Mine now"}),
        ("POST", "/use", {}),
        ("POST", "/waste", {}),
        ("DELETE", "", None),
    ]:
        res = await api.request(method, f"/api/foods/{food_id}{suffix}", headers=bob.headers, json=body)
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "NOT_FOUND"
    untouched = await stored(food_id)
    assert (untouched["name"], untouched["status"], untouched["quantity"]) == ("Milk", "ACTIVE", 0.5)


async def test_cannot_undo_open_move_or_bring_forward_another_households_item(
    api: httpx.AsyncClient, people: tuple[Account, Account, str]
) -> None:
    alice, bob, food_id = people
    for method, suffix, body in [
        ("POST", "/undo", None),
        ("POST", "/use-today", None),
        ("POST", "/open", {"daysLeft": 3}),
        ("DELETE", "/open", None),
        ("POST", "/move", {"storage": "FREEZER", "daysLeft": 30}),
    ]:
        res = await api.request(method, f"/api/foods/{food_id}{suffix}", headers=bob.headers, json=body)
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "NOT_FOUND"
    untouched = await stored(food_id)
    assert (untouched["status"], untouched["quantity"], untouched["storage"], untouched["openedDate"]) == (
        "ACTIVE",
        0.5,
        "FRIDGE",
        None,
    )
    # Alice's own undo still has its usage record to reverse.
    assert (await api.post(f"/api/foods/{food_id}/undo", headers=alice.headers)).status_code == 200


async def test_cannot_remove_or_re_add_another_users_favourite(
    api: httpx.AsyncClient, people: tuple[Account, Account, str]
) -> None:
    alice, bob, _food_id = people
    favourite = await api.post(
        "/api/favourites",
        headers=alice.headers,
        json={"name": "Eggs", "quantity": 6, "unit": "pcs", "lifespanDays": 14},
    )
    assert favourite.status_code == 201
    favourite_id = favourite.json()["id"]
    assert (await api.delete(f"/api/favourites/{favourite_id}", headers=bob.headers)).status_code == 404
    assert (await api.post(f"/api/favourites/{favourite_id}/add", headers=bob.headers)).status_code == 404
    assert len((await api.get("/api/favourites", headers=alice.headers)).json()["items"]) == 1
    assert (await api.get("/api/foods", headers=bob.headers)).json()["items"] == []


async def test_ignores_a_user_id_passed_in_the_query_string(api: httpx.AsyncClient) -> None:
    """rules.test.ts: "ignores a userId passed in the query string"."""
    alice = await register_user(api)
    bob = await register_user(api)
    assert (await api.post("/api/foods", headers=alice.headers, json=food(name="Alice milk"))).status_code == 201
    res = await api.get(f"/api/foods?userId={alice.user['id']}", headers=bob.headers)
    assert res.status_code == 200
    assert res.json()["items"] == []
