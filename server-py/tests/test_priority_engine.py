"""The priority engine (server/src/tests/priorityEngine.test.ts, all 12 tests)."""

import copy
import json
from typing import Any

import pytest

from server_py.config.urgency import APPROACHING_EXPIRY_DAYS
from server_py.services.priority_engine import classify_urgency, prioritise
from server_py.shared.dates import add_days

pytestmark = pytest.mark.phase2

TODAY = "2026-09-29"


def item(item_id: str, added_date: str, lifespan_days: int, status: str = "ACTIVE") -> dict[str, Any]:
    return {"id": item_id, "status": status, "addedDate": added_date, "expiryDate": add_days(added_date, lifespan_days)}


def ids(items: list[dict[str, Any]]) -> list[str]:
    return [i["id"] for i in items]


def test_sorts_items_with_different_expiry_dates_earliest_first() -> None:
    result = prioritise([item("late", TODAY, 9), item("soon", TODAY, 1), item("mid", TODAY, 5)], TODAY)
    assert ids(result["items"]) == ["soon", "mid", "late"]


def test_orders_the_same_expiry_date_by_added_date_then_id() -> None:
    result = prioritise(
        [item("c", "2026-09-27", 3), item("b", "2026-09-25", 5), item("a", "2026-09-27", 3)],
        TODAY,
    )
    assert ids(result["items"]) == ["b", "a", "c"]


def test_compares_ids_as_strings() -> None:
    result = prioritise([item("10", TODAY, 2), item("9", TODAY, 2), item("100", TODAY, 2)], TODAY)
    assert ids(result["items"]) == ["10", "100", "9"]


def test_excludes_used_wasted_and_removed_items() -> None:
    result = prioritise(
        [
            item("active", TODAY, 1),
            item("used", TODAY, 1, "USED"),
            item("wasted", TODAY, 1, "WASTED"),
            item("removed", TODAY, 1, "REMOVED"),
        ],
        TODAY,
    )
    assert ids(result["items"]) == ["active"]
    assert ids(result["cookFirst"]) == ["active"]
    assert result["summary"]["total"] == 1


@pytest.mark.parametrize(
    ("remaining", "urgency"),
    [(4, "NOT_URGENT"), (3, "APPROACHING_EXPIRY"), (1, "APPROACHING_EXPIRY"), (0, "DUE"), (-1, "OVERDUE")],
)
def test_switches_urgency_at_exactly_the_right_point(remaining: int, urgency: str) -> None:
    [first] = prioritise([item("x", add_days(TODAY, remaining), 0)], TODAY)["items"]
    assert (first["remainingDays"], first["urgency"]) == (remaining, urgency)
    assert classify_urgency(remaining) == urgency


def test_uses_the_single_threshold_constant() -> None:
    assert APPROACHING_EXPIRY_DAYS == 3
    assert classify_urgency(APPROACHING_EXPIRY_DAYS) == "APPROACHING_EXPIRY"
    assert classify_urgency(APPROACHING_EXPIRY_DAYS + 1) == "NOT_URGENT"


def test_a_zero_day_lifespan_is_due_on_the_day_it_is_added() -> None:
    result = prioritise([item("yoghurt", TODAY, 0)], TODAY)
    first = result["items"][0]
    assert (first["expiryDate"], first["remainingDays"], first["urgency"]) == (TODAY, 0, "DUE")
    assert ids(result["cookFirst"]) == ["yoghurt"]


def test_gives_identical_output_when_run_twice() -> None:
    given = [item("x", "2026-09-20", 5), item("y", "2026-09-28", 2), item("z", "2026-09-28", 2), item("w", TODAY, 9)]
    first, second = prioritise(given, TODAY), prioritise(given, TODAY)
    assert second == first
    assert json.dumps(second) == json.dumps(first)


def test_gives_the_same_order_whatever_order_the_items_arrive_in() -> None:
    given = [item("x", "2026-09-20", 5), item("y", "2026-09-28", 2), item("z", "2026-09-28", 2), item("w", TODAY, 0)]
    assert ids(prioritise(list(reversed(given)), TODAY)["items"]) == ids(prioritise(given, TODAY)["items"])


def test_does_not_change_the_items_it_is_given() -> None:
    given = [item("b", TODAY, 2), item("a", TODAY, 1)]
    before = copy.deepcopy(given)
    prioritise(given, TODAY)
    assert given == before


def test_chicken_spinach_milk_eggs() -> None:
    result = prioritise(
        [item("eggs", TODAY, 8), item("milk", TODAY, 4), item("chicken", TODAY, 1), item("spinach", TODAY, 2)], TODAY
    )
    assert ids(result["items"]) == ["chicken", "spinach", "milk", "eggs"]
    assert ids(result["cookFirst"]) == ["chicken", "spinach"]
    assert result["summary"] == {"NOT_URGENT": 2, "APPROACHING_EXPIRY": 2, "DUE": 0, "OVERDUE": 0, "total": 4}


def test_cook_first_keeps_the_full_lists_order_with_a_summary() -> None:
    result = prioritise(
        [item("later", TODAY, 7), item("soon", TODAY, 3), item("due", TODAY, 0), item("overdue", "2026-09-20", 2)],
        TODAY,
    )
    assert ids(result["items"]) == ["overdue", "due", "soon", "later"]
    assert ids(result["cookFirst"]) == ["overdue", "due", "soon"]
    assert result["summary"] == {"NOT_URGENT": 1, "APPROACHING_EXPIRY": 1, "DUE": 1, "OVERDUE": 1, "total": 4}
