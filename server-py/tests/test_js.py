"""JavaScript's rules that the server copies (server_py/shared/js.py, schemas/zod.py). Expected values recorded
from Node 24."""

import math

import pytest

from server_py.schemas.zod import js_number
from server_py.shared.js import locale_compare_key, math_round

pytestmark = pytest.mark.phase2


def test_math_round_takes_halves_up() -> None:
    values = [0.5, 1.5, 2.5, -0.5, -1.5, 0.49999999999999994, 2.675 * 100, 1.005 * 1000]
    assert [math_round(v) for v in values] == [1, 2, 3, 0, -1, 0, 268, 1005]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", 0),
        (" 12 ", 12),
        ("0x10", 16),
        ("1e2", 100),
        ("-0x10", math.nan),
        (".5", 0.5),
        ("5.", 5),
        ("+5", 5),
        ("Infinity", math.inf),
        (["5"], 5),
        (["1", "2"], math.nan),
        ([], 0),
        (None, 0),
        (True, 1),
        ("abc", math.nan),
    ],
)
def test_number_converts_as_javascript_does(value: object, expected: float) -> None:
    result = js_number(value)
    assert math.isnan(result) if math.isnan(expected) else result == expected


def test_locale_compare_orders_names_as_icu_does() -> None:
    names = [
        "milk", "Milk", "Äpfel", "apple", "Apple", "banana", "Ölive", "olive", "zucchini", "Éclair",
        "eclair", "Ice cream", "Ice-cream", "Icecream", "ice cream", "2 eggs", "10 eggs", "Brie", "brie de meaux",
        "Brie de Meaux", "_salt", "(spices)", "yoghurt", "Yogurt", "ñame", "nectarine", "Œufs", "oeufs",
        "straße", "strasse", "Strasse", "Ærø cheese", "aero", "chili", "chilli", "Chili",
        "émincé", "emince", "café", "cafe", "Café au lait",
    ]  # fmt: skip
    # [...names].sort((a, b) => a.localeCompare(b)) in Node.
    expected = [
        "_salt", "(spices)", "10 eggs", "2 eggs", "aero", "Ærø cheese", "Äpfel", "apple", "Apple",
        "banana", "Brie", "brie de meaux", "Brie de Meaux", "cafe", "café", "Café au lait", "chili",
        "Chili", "chilli", "eclair", "Éclair", "emince", "émincé", "ice cream", "Ice cream",
        "Ice-cream", "Icecream", "milk", "Milk", "ñame", "nectarine", "oeufs", "Œufs", "olive",
        "Ölive", "strasse", "Strasse", "straße", "yoghurt", "Yogurt", "zucchini",
    ]  # fmt: skip
    assert sorted(names, key=locale_compare_key) == expected
    assert sorted(["PANTRY", "FRIDGE", "FREEZER"], key=locale_compare_key) == ["FREEZER", "FRIDGE", "PANTRY"]
