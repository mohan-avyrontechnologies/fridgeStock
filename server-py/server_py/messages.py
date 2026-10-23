"""Every user-facing sentence the server produces about expiry comes from here (server/src/copy.ts; named
messages.py because `copy` is a standard-library module).

The sentences live in shared/data/messages.json, which the TypeScript server reads too; this module only fills
them in. Food-safety boundary (BRD §10.3): dates are planning estimates. Never claim food is fit to eat; use
"expected expiry" wording only.
"""

from collections.abc import Sequence
from typing import Any, Final

from server_py.shared.data import load
from server_py.shared.template import fill_template

_COPY: Final[dict[str, Any]] = load("messages")
_PROMPTS: Final[dict[str, Any]] = _COPY["aiPrompts"]


def _days(n: int) -> str:
    """ "1 day", "2 days"."""
    return _COPY["days"]["one"] if n == 1 else fill_template(_COPY["days"]["other"], {"n": n})


def _lines(text: Sequence[str], values: dict[str, str | int | float] | None = None) -> str:
    return "\n".join(fill_template(line, values) for line in text)


def _list(names: Sequence[str]) -> str:
    """ "a", "a and b", "a, b and c"."""
    if len(names) <= 1:
        return names[0] if names else ""
    return f"{', '.join(names[:-1])} and {names[-1]}"


# Reminder messages. The number of days is worked out at the moment the reminder is sent.
def reminder_approaching(name: str, remaining_days: int) -> str:
    return fill_template(_COPY["reminder"]["APPROACHING_EXPIRY"], {"name": name, "days": _days(remaining_days)})


def reminder_due(name: str) -> str:
    return fill_template(_COPY["reminder"]["DUE"], {"name": name})


def reminder_overdue(name: str) -> str:
    return fill_template(_COPY["reminder"]["OVERDUE"], {"name": name})


# Push notifications. Per-item pushes reuse the reminder text.
PUSH_TITLE: Final[str] = _COPY["push"]["title"]
PUSH_ACTIONS: Final[dict[str, str]] = _COPY["push"]["actions"]


def digest_title(count: int) -> str:
    titles = _COPY["push"]["digestTitle"]
    return titles["one"] if count == 1 else fill_template(titles["other"], {"count": count})


def digest_line(name: str, remaining_days: int) -> str:
    """One line of the daily summary, in Cook First order."""
    lines = _COPY["push"]["digestLine"]
    if remaining_days > 0:
        return fill_template(lines["future"], {"name": name, "days": _days(remaining_days)})
    if remaining_days == 0:
        return fill_template(lines["today"], {"name": name})
    return fill_template(lines["past"], {"name": name})


def digest_more(count: int) -> str:
    return fill_template(_COPY["push"]["digestMore"], {"count": count})


# Sentences stored with an expected expiry that the app changed because the person asked it to.
ADJUSTED_PHOTO_CHECK: Final[str] = _COPY["adjusted"]["photoCheck"]

# AI features: messages shown to the user.
AI_NOT_ENABLED: Final[str] = _COPY["ai"]["notEnabled"]
AI_FAILED: Final[str] = _COPY["ai"]["failed"]
AI_BUSY: Final[str] = _COPY["ai"]["busy"]


def ai_limit_reached(limit: int) -> str:
    return fill_template(_COPY["ai"]["limitReached"], {"limit": limit})


def prompt_line(code: str, name: str, quantity: float, unit: str, remaining_days: int) -> str:
    """One line describing an item for an AI prompt, e.g. "F1: Chicken (500 g): expected expiry today"."""
    item = fill_template("{name} ({quantity} {unit})", {"name": name, "quantity": quantity, "unit": unit})
    return fill_template(_COPY["promptLine"], {"code": code, "line": digest_line(item, remaining_days)})


# Instructions sent to the AI model. They must never contain a banned phrase or comment on food condition.
PROMPT_SYSTEM: Final[str] = _lines(_PROMPTS["system"])
PROMPT_RECEIPT_SYSTEM: Final[str] = _lines(_PROMPTS["receiptSystem"])
PROMPT_PHOTO_SYSTEM: Final[str] = _lines(_PROMPTS["photoSystem"])
PROMPT_DATE_SYSTEM: Final[str] = _lines(_PROMPTS["dateSystem"])
PROMPT_DATE: Final[str] = _PROMPTS["date"]
PROMPT_FIX_FORMAT: Final[str] = _PROMPTS["fixFormat"]
PROMPT_FIX_WORDING: Final[str] = _PROMPTS["fixWording"]


def prompt_receipt(known_names: Sequence[str], today: str) -> str:
    return _lines(_PROMPTS["receipt"], {"knownNames": ", ".join(known_names), "today": today})


def prompt_photo(known_names: Sequence[str]) -> str:
    return _lines(_PROMPTS["photo"], {"knownNames": ", ".join(known_names)})


def prompt_recipes(
    cook_first: Sequence[str], others: Sequence[str], meal_type: str | None = None, avoid: Sequence[str] | None = None
) -> str:
    recipes = _PROMPTS["recipes"]
    lines = [recipes["intro"], *cook_first]
    if others:
        lines += ["", recipes["othersHeading"], *others]
    lines += ["", recipes["ask"]]
    if meal_type:
        lines.append(fill_template(recipes["mealType"], {"mealType": meal_type}))
    if avoid:
        lines.append(fill_template(recipes["avoid"], {"avoid": "; ".join(avoid)}))
    lines += recipes["rules"]
    return "\n".join(lines)


def prompt_meal_plan(dates: Sequence[str], items: Sequence[str]) -> str:
    plan = _PROMPTS["mealPlan"]
    return "\n".join([plan["intro"], *items, "", _lines(plan["rules"], {"dates": ", ".join(dates)})])


# Meal-time cooking reminders. The lines naming items reuse digest_line, so they carry expected-expiry wording.
MEAL_TITLES: Final[dict[str, str]] = _COPY["meal"]["title"]
MEAL_ITEMS_INTRO: Final[str] = _COPY["meal"]["itemsIntro"]
MEAL_ACTIONS: Final[dict[str, str]] = _COPY["meal"]["actions"]


def meal_plan(title: str, foods: Sequence[str]) -> str:
    plan = _COPY["meal"]["plan"]
    if foods:
        return fill_template(plan["withFoods"], {"title": title, "foods": _list(foods)})
    return fill_template(plan["withoutFoods"], {"title": title})


def meal_recipe(title: str, minutes: float, uses: Sequence[str]) -> str:
    return fill_template(_COPY["meal"]["recipe"], {"title": title, "minutes": minutes, "uses": _list(uses)})
