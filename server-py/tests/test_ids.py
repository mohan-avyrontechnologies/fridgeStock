"""Primary keys (server_py/db/ids.py): UUIDv7 that sort in creation order, as ObjectIds do (§4, "IDs")."""

import time
from unittest.mock import patch
from uuid import UUID

import pytest

from server_py.db import ids
from server_py.db.ids import new_id, parse_id

pytestmark = pytest.mark.phaseP


def test_ids_are_uuid_version_7_with_the_rfc_variant() -> None:
    made = new_id()
    assert made.version == 7
    assert made.variant == "specified in RFC 4122"
    assert str(made) == str(made).lower()


def test_the_first_48_bits_are_the_time_in_milliseconds() -> None:
    before = time.time_ns() // 1_000_000
    made = new_id()
    after = time.time_ns() // 1_000_000
    assert before <= made.int >> 80 <= after + 1


def test_ten_thousand_ids_made_in_a_tight_loop_sort_in_creation_order() -> None:
    made = [new_id() for _ in range(10_000)]
    assert len(set(made)) == len(made)
    assert sorted(made) == made
    assert sorted(map(str, made)) == [str(value) for value in made]  # as text too, which is how the API sends them


def test_ids_keep_their_order_when_the_counter_runs_out_or_the_clock_steps_back() -> None:
    with patch.object(ids.time, "time_ns", return_value=1_700_000_000_000 * 1_000_000):
        same_millisecond = [new_id() for _ in range(5_000)]  # more than the 4,096 a millisecond's counter holds
    with patch.object(ids.time, "time_ns", return_value=1_600_000_000_000 * 1_000_000):
        after_the_clock_went_back = new_id()
    back_to_now = new_id()  # both times are in the past, so the real clock takes over again
    made = [*same_millisecond, after_the_clock_went_back, back_to_now]
    assert sorted(made) == made
    assert len(set(made)) == len(made)
    assert back_to_now.int >> 80 >= time.time_ns() // 1_000_000 - 1_000


def test_only_a_uuid_is_an_id() -> None:
    made = new_id()
    assert parse_id(str(made)) == made
    assert parse_id(str(made).upper()) == made
    assert parse_id("0192f3c4-7b1e-7c2a-9d4e-3f6a8b2c1d00") == UUID("0192f3c4-7b1e-7c2a-9d4e-3f6a8b2c1d00")
    for text in [
        "0123456789abcdef01234567",  # a Node ObjectId
        str(made).replace("-", ""),
        f"{{{made}}}",
        f"urn:uuid:{made}",
        str(made)[:-1],
        f"{made}0",
        f" {made}",
        f"{made}\n",
        "",
    ]:
        assert parse_id(text) is None, text
