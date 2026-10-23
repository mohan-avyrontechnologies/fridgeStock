"""The shared test cases in shared/test-cases/*.json, which the TypeScript suites pass too.

Each file is {description, functions: {name: [{args, expected} | {args, throws}]}}. A name without a function
(a constant) is compared with `expected` as it is. Results are compared in their JSON form, as TypeScript does.
"""

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from server_py import messages
from server_py.schemas import PENDING, SCHEMAS
from server_py.services import priority_engine
from server_py.shared import alerts, barcode, dates, estimate, estimate_copy, reference, wording

CASES_DIR = Path(__file__).resolve().parents[2] / "shared" / "test-cases"
ERRORS: dict[str, type[Exception]] = {"RangeError": dates.RangeError}


def at[R](fn: Callable[..., R]) -> Callable[..., R]:
    """Functions that take a time zone and then a time: the cases write the time as an ISO instant."""

    def call(time_zone: str, now: str, *rest: object) -> R:
        return fn(time_zone, datetime.fromisoformat(now), *rest)

    return call


IMPLEMENTATIONS: dict[str, dict[str, Any]] = {
    "alerts": {
        "clockMinutes": alerts.clock_minutes,
        "minutesInTz": at(alerts.minutes_in_tz),
        "isQuietHours": at(alerts.is_quiet_hours),
        "kindOfReminder": alerts.kind_of_reminder,
        "isUrgent": alerts.is_urgent,
        "soundFor": alerts.sound_for,
        "vibrationFor": alerts.vibration_for,
        "channelFor": alerts.channel_for,
        "alertFor": alerts.alert_for,
        "mergesWithDigest": alerts.merges_with_digest,
        "DEFAULT_ALERTS": alerts.DEFAULT_ALERTS,
        "DEFAULT_MEAL_REMINDERS": alerts.DEFAULT_MEAL_REMINDERS,
        "DIGEST_MERGE_MINUTES": alerts.DIGEST_MERGE_MINUTES,
        "MEAL_LABELS": alerts.MEAL_LABELS,
    },
    "barcode": {"isValidBarcode": barcode.is_valid_barcode, "cleanBarcode": barcode.clean_barcode},
    "dates": {
        "isValidDate": dates.is_valid_date,
        "todayInTz": at(dates.today_in_tz),
        "hourInTz": at(dates.hour_in_tz),
        "addDays": dates.add_days,
        "diffDays": dates.diff_days,
        "formatDisplay": dates.format_display,
    },
    "estimate": {
        "estimateExpiry": estimate.estimate_expiry,
        "recalculateExpiry": estimate.recalculate_expiry,
        "lifespanFor": estimate.lifespan_for,
        "isUsablePrintedDate": estimate.is_usable_printed_date,
        "parsePrintedDate": estimate.parse_printed_date,
        "dayMonthOrder": estimate.day_month_order,
        "expirySourceLabel": estimate.expiry_source_label,
        "EXPIRY_SOURCE_LABELS": estimate.EXPIRY_SOURCE_LABELS,
        "FALLBACK_LIFESPAN_DAYS": estimate.FALLBACK_LIFESPAN_DAYS,
        "MAX_LIFESPAN_DAYS": estimate.MAX_LIFESPAN_DAYS,
        "USER_EXPLANATION": estimate_copy.USER_EXPLANATION,
    },
    "messages": {
        "reminder.APPROACHING_EXPIRY": messages.reminder_approaching,
        "reminder.DUE": messages.reminder_due,
        "reminder.OVERDUE": messages.reminder_overdue,
        "push.title": messages.PUSH_TITLE,
        "push.digestTitle": messages.digest_title,
        "push.digestLine": messages.digest_line,
        "push.digestMore": messages.digest_more,
        "push.actions": messages.PUSH_ACTIONS,
        "adjusted.photoCheck": messages.ADJUSTED_PHOTO_CHECK,
        "ai.notEnabled": messages.AI_NOT_ENABLED,
        "ai.failed": messages.AI_FAILED,
        "ai.busy": messages.AI_BUSY,
        "ai.limitReached": messages.ai_limit_reached,
        "promptLine": messages.prompt_line,
        "aiPrompts.system": messages.PROMPT_SYSTEM,
        "aiPrompts.receiptSystem": messages.PROMPT_RECEIPT_SYSTEM,
        "aiPrompts.receipt": messages.prompt_receipt,
        "aiPrompts.photoSystem": messages.PROMPT_PHOTO_SYSTEM,
        "aiPrompts.photo": messages.prompt_photo,
        "aiPrompts.dateSystem": messages.PROMPT_DATE_SYSTEM,
        "aiPrompts.date": lambda: messages.PROMPT_DATE,
        "aiPrompts.recipes": messages.prompt_recipes,
        "aiPrompts.mealPlan": messages.prompt_meal_plan,
        "aiPrompts.fixFormat": messages.PROMPT_FIX_FORMAT,
        "aiPrompts.fixWording": messages.PROMPT_FIX_WORDING,
        "meal.title": messages.MEAL_TITLES,
        "meal.plan": messages.meal_plan,
        "meal.recipe": messages.meal_recipe,
        "meal.itemsIntro": messages.MEAL_ITEMS_INTRO,
        "meal.actions": messages.MEAL_ACTIONS,
    },
    "priority": {"classifyUrgency": priority_engine.classify_urgency, "prioritise": priority_engine.prioritise},
    "reference": {
        "FOOD_REFERENCE": reference.FOOD_REFERENCE,
        "CATEGORY_DEFAULTS": reference.CATEGORY_DEFAULTS,
        "REFERENCE_SOURCE": reference.REFERENCE_SOURCE,
        "findReference": reference.find_reference,
        "searchReference": reference.search_reference,
        "categoryFromText": reference.category_from_text,
        "usualStorage": reference.usual_storage,
    },
    "validation": SCHEMAS,
    "wording": {"hasBannedWording": wording.has_banned_wording, "BANNED_PHRASES": wording.BANNED_PHRASES},
}


def load(name: str) -> dict[str, list[dict[str, Any]]]:
    with (CASES_DIR / f"{name}.json").open(encoding="utf-8") as file:
        return json.load(file)["functions"]


def as_json(value: object) -> object:
    """A result as it looks written as JSON, the form the cases record."""
    return json.loads(json.dumps(value))


def check(implementation: object, case: dict[str, Any]) -> None:
    def call() -> object:
        return implementation(*case["args"]) if callable(implementation) else implementation

    if "throws" in case:
        with pytest.raises(ERRORS[case["throws"]]):
            call()
    else:
        assert as_json(call()) == case["expected"]


def test_every_case_file_is_checked() -> None:
    assert sorted(path.stem for path in CASES_DIR.glob("*.json")) == sorted(IMPLEMENTATIONS)


def test_every_validation_schema_is_ported_or_pending() -> None:
    names = set(load("validation"))
    assert not set(SCHEMAS) & PENDING
    assert names == set(SCHEMAS) | PENDING


@pytest.mark.parametrize(
    ("file", "name"),
    [
        (file, name)
        for file in sorted(IMPLEMENTATIONS)
        for name in load(file)
        if not (file == "validation" and name in PENDING)
    ],
)
def test_shared_cases(file: str, name: str) -> None:
    implementations = IMPLEMENTATIONS[file]
    assert name in implementations, f"{name} has no Python implementation"
    cases = load(file)[name]
    assert cases
    failures: list[str] = []
    for case in cases:
        try:
            check(implementations[name], case)
        except AssertionError as error:
            failures.append(f"{name}({json.dumps(case['args'])[1:-1][:200]}): {str(error)[:300]}")
        except Exception as error:
            failures.append(f"{name}({json.dumps(case['args'])[1:-1][:200]}): raised {error!r}")
    assert not failures, f"{len(failures)} of {len(cases)} cases differ:\n" + "\n".join(failures[:15])
