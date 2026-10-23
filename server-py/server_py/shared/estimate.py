"""Automatic expected-expiry estimation and reading printed dates (shared/src/estimate.ts).

Nobody types a lifespan: the date comes from the pack, the household's own history, or the catalog. The AI
may only identify a product and read a date printed on the pack; it never supplies a number of days.
It estimates an *expected expiry* for planning. It says nothing about whether food is fit to eat.
"""

import calendar
import re
from collections.abc import Sequence
from typing import Final, Literal, NotRequired, TypedDict, cast

from server_py.shared import estimate_copy
from server_py.shared.data import load
from server_py.shared.dates import DateString, add_days, diff_days, is_valid_date
from server_py.shared.enums import ExpirySource, FoodCategory, PrintedDateType, StorageLocation
from server_py.shared.js import SPACE, trim
from server_py.shared.reference import CATEGORY_DEFAULTS, ReferenceFood, category_from_text, find_reference

FALLBACK_LIFESPAN_DAYS: Final = 3
"""The lifespan used when nothing else is known. Short on purpose, and always shown as "Rough estimate"."""

PRINTED_DATE_MAX_AHEAD_DAYS: Final = 730
"""A printed date more than this many days in the future is treated as a misread."""
PRINTED_DATE_MAX_PAST_DAYS: Final = 30
"""A printed date more than this many days in the past is treated as stale or a misread."""

MAX_LIFESPAN_DAYS: Final = 365
"""The longest lifespan an item can have, in days."""

EXPIRY_SOURCE_LABELS: Final[dict[ExpirySource, str]] = {
    "PRINTED_DATE": "Printed date",
    "LEARNED": "Your usual",
    "CATALOG": "Catalog",
    "CATEGORY_DEFAULT": "Category",
    "FALLBACK": "Rough estimate",
    "USER": "You set this",
}
"""Where each source is shown to people: a short label for cards."""

EstimatedSource = Literal["PRINTED_DATE", "LEARNED", "CATALOG", "CATEGORY_DEFAULT", "FALLBACK"]


class LearnedLifespan(TypedDict):
    name: str
    storage: StorageLocation
    days: int
    samples: int


class Product(TypedDict):
    name: str


class EstimateInput(TypedDict):
    product: Product
    storage: StorageLocation
    addedDate: DateString
    catalogMatch: NotRequired[ReferenceFood | None]
    """The catalog entry, or None for none. Left out: looked up by name."""
    category: NotRequired[FoodCategory | str | None]
    printedDate: NotRequired[DateString | None]
    printedDateType: NotRequired[PrintedDateType | None]
    usageHistory: NotRequired[Sequence[LearnedLifespan]]
    openedDate: NotRequired[DateString | None]
    today: NotRequired[DateString]
    """Today in the user's time zone; the printed date's range check uses it. Defaults to the added date."""


class ExpiryEstimate(TypedDict):
    expiryDate: DateString
    source: EstimatedSource
    explanation: str
    """One short sentence, in "expected expiry" wording."""


def is_usable_printed_date(printed_date: object, today: object) -> bool:
    """True for a real date, at most two years ahead and not more than 30 days past."""
    if not is_valid_date(printed_date) or not is_valid_date(today):
        return False
    away = diff_days(cast(str, today), cast(str, printed_date))
    return -PRINTED_DATE_MAX_PAST_DAYS <= away <= PRINTED_DATE_MAX_AHEAD_DAYS


def estimate_expiry(data: EstimateInput) -> ExpiryEstimate:
    """Works out the expected expiry. The sources, in priority order:

    1. PRINTED_DATE: the date read from the pack (ignored if out of range).
    2. LEARNED: the household's learned lifespan, only when shorter than the catalog's (or category's) figure.
    3. CATALOG: the catalog lifespan in this location (and, once opened, its opened lifespan).
    4. CATEGORY_DEFAULT: the category's default, for a product the catalog has no figure for.
    5. FALLBACK: only when none of the above applies.

    When more than one of 1-4 applies, the earliest date wins; a tie goes to the source higher in the list.
    """
    name = data["product"]["name"]
    storage = data["storage"]
    added = data["addedDate"]
    opened = data.get("openedDate")
    history = data.get("usageHistory") or []
    given_today = data.get("today")
    today = given_today if given_today is not None else added
    catalog = find_reference(name) if "catalogMatch" not in data else data["catalogMatch"]
    given = data.get("category")
    category: str | None = (
        catalog["category"] if catalog else ((category_from_text(given) or given) if isinstance(given, str) else given)
    )
    category = category or None
    candidates: list[tuple[str, int, ExpiryEstimate]] = []

    def add(rank: int, expiry: str, source: EstimatedSource, explanation: str) -> None:
        candidates.append((expiry, rank, {"expiryDate": expiry, "source": source, "explanation": explanation}))

    # 1. The printed date.
    printed = data.get("printedDate")
    if printed and is_usable_printed_date(printed, today):
        printed_type = data.get("printedDateType")
        add(1, printed, "PRINTED_DATE", estimate_copy.printed(printed_type if printed_type is not None else "UNKNOWN"))

    # The reference figure the learned lifespan is measured against, and the catalog or category candidate.
    catalog_days = catalog["lifespanDays"][storage] if catalog else None
    category_key = category if category in CATEGORY_DEFAULTS else None
    category_days = CATEGORY_DEFAULTS[category_key][storage] if category_key else None
    reference_days = catalog_days if catalog_days is not None else category_days

    # 2. What this household usually gets, only when it is shorter than the reference figure.
    wanted = trim(name).lower()
    learned = next((h for h in history if trim(h["name"]).lower() == wanted and h["storage"] == storage), None)
    if learned and (reference_days is None or learned["days"] < reference_days):
        add(2, add_days(added, learned["days"]), "LEARNED", estimate_copy.learned(name, learned["days"], storage))

    # 3. The catalog, including its shorter lifespan once opened.
    if catalog_days is not None:
        expiry = add_days(added, catalog_days)
        explanation = estimate_copy.catalog(name, catalog_days, storage)
        opened_days = catalog["openedDays"] if catalog else None
        if opened and opened_days is not None:
            after_opening = add_days(opened, opened_days)
            if after_opening < expiry:
                expiry = after_opening
                explanation = estimate_copy.catalog_opened(name, opened_days)
        add(3, expiry, "CATALOG", explanation)
    elif category_days is not None:
        # 4. The category default.
        add(4, add_days(added, category_days), "CATEGORY_DEFAULT", estimate_copy.category(category_days, storage))

    if not candidates:
        return {
            "expiryDate": add_days(added, FALLBACK_LIFESPAN_DAYS),
            "source": "FALLBACK",
            "explanation": estimate_copy.fallback(FALLBACK_LIFESPAN_DAYS),
        }

    # Never beyond the longest lifespan an item can have.
    estimate = min(candidates, key=lambda candidate: (candidate[0], candidate[1]))[2]
    longest = add_days(added, MAX_LIFESPAN_DAYS)
    return {**estimate, "expiryDate": longest} if estimate["expiryDate"] > longest else estimate


def recalculate_expiry(current: DateString, data: EstimateInput) -> ExpiryEstimate | None:
    """Re-estimates an item after a move, opening or Photo Check. Only ever shorter: None when nothing changes."""
    following = estimate_expiry(data)
    return following if following["expiryDate"] < current else None


def lifespan_for(added_date: DateString, expiry_date: DateString) -> int:
    """The lifespan in days from the added date to an expected expiry (what the server stores next to it)."""
    return min(max(diff_days(added_date, expiry_date), 0), MAX_LIFESPAN_DAYS)


def expiry_source_label(source: ExpirySource) -> str:
    """The text a card shows for where its expected expiry came from."""
    return EXPIRY_SOURCE_LABELS[source]


# ───────────────────────── Reading a printed date ─────────────────────────

DayMonthOrder = Literal["DMY", "MDY"]


def _date_orders() -> dict[str, DayMonthOrder]:
    table = load("date-order")
    orders: dict[str, DayMonthOrder] = {tag.lower(): "DMY" for tag in table["DMY"]}
    orders.update({tag.lower(): "MDY" for tag in table["MDY"]})
    return orders


_DATE_ORDERS: Final = _date_orders()
"""shared/data/date-order.json by lower-case tag."""


def day_month_order(locale: str | None) -> DayMonthOrder | None:
    """Whether a locale writes the day before the month ("en-GB": DMY) or after it ("en-US": MDY).

    None when unknown. It looks the tag up in shared/data/date-order.json, as the TypeScript code does, so the
    same date reads the same on every server and in every browser. A tag that isn't listed is tried without its
    last part (en-GB-oxendict, then en-GB, then en).
    """
    parts = (locale or "").lower().split("-")
    while parts and parts[0]:
        order = _DATE_ORDERS.get("-".join(parts))
        if order:
            return order
        parts.pop()
    return None


_MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTH_FULL_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]  # fmt: skip

_S = SPACE
_YEAR_FIRST = re.compile(r"([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})")
_NAMED = re.compile(rf"([0-9]{{1,2}})(?:{_S}|[./-])*([a-z]{{3,9}})\.?(?:{_S}|[,./-])*([0-9]{{2}}|[0-9]{{4}})")
_NAMED_MONTH_FIRST = re.compile(
    rf"([a-z]{{3,9}})\.?(?:{_S}|[./-])*([0-9]{{1,2}})(?:st|nd|rd|th)?(?:{_S}|[,./-])+([0-9]{{2}}|[0-9]{{4}})"
)
_NAMED_MONTH_YEAR = re.compile(rf"([a-z]{{3,9}})\.?(?:{_S}|[./-])*([0-9]{{2}}|[0-9]{{4}})")
_MONTH_YEAR = re.compile(r"([0-9]{1,2})[./-]([0-9]{4})")
_NUMERIC = re.compile(r"([0-9]{1,2})[./-]([0-9]{1,2})[./-]([0-9]{2}|[0-9]{4})")


def _build(year: int, month: int, day: int) -> DateString | None:
    text = f"{year:04d}-{month:02d}-{day:02d}"
    return text if is_valid_date(text) else None


def _full_year(text: str) -> int:
    return 2000 + int(text) if len(text) <= 2 else int(text)


def _last_day_of_month(year: int, month: int) -> DateString | None:
    if not 1 <= month <= 12 or year < 1:
        return None
    return _build(year, month, calendar.monthrange(year, month)[1])


def _month_number(word: str) -> int | None:
    """1-12 for a month written as its first three letters or its full English name ("sept" works too)."""
    try:
        index = _MONTH_NAMES.index(word[:3])
    except ValueError:
        return None
    return index + 1 if len(word) == 3 or _MONTH_FULL_NAMES[index].startswith(word) else None


def parse_printed_date(text: str | None, locale: str | None = None) -> DateString | None:
    """Turns a date read off a pack ("12/11/26", "5 NOV 2026", "2026-11-05", "11/2026") into a calendar date.

    Day/month order for an all-number date follows the locale. A reading that isn't a real date is dropped,
    so "13/05" is day first in any locale. With no known order and two real readings, the earlier is used.
    A month and year with no day means the last day of that month.
    """
    raw = trim(text or "").lower()
    if not raw:
        return None

    if match := _YEAR_FIRST.fullmatch(raw):
        return _build(int(match[1]), int(match[2]), int(match[3]))

    if match := _NAMED.fullmatch(raw):
        month = _month_number(match[2])
        return _build(_full_year(match[3]), month, int(match[1])) if month else None
    if match := _NAMED_MONTH_FIRST.fullmatch(raw):
        month = _month_number(match[1])
        return _build(_full_year(match[3]), month, int(match[2])) if month else None
    if match := _NAMED_MONTH_YEAR.fullmatch(raw):
        month = _month_number(match[1])
        return _last_day_of_month(_full_year(match[2]), month) if month else None

    if match := _MONTH_YEAR.fullmatch(raw):
        return _last_day_of_month(int(match[2]), int(match[1]))

    if match := _NUMERIC.fullmatch(raw):
        first, second, year = int(match[1]), int(match[2]), _full_year(match[3])
        day_first = _build(year, second, first)
        month_first = _build(year, first, second)
        if day_first and month_first and day_first != month_first:
            order = day_month_order(locale)
            if order == "DMY":
                return day_first
            if order == "MDY":
                return month_first
            return min(day_first, month_first)
        return day_first or month_first
    return None
