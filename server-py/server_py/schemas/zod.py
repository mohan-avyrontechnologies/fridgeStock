"""The parts of zod 4 the request schemas use, so the API answers in zod's words and order.

Each schema in shared/src/schemas.ts is rebuilt here from the same pieces (`string().trim().min(1, ...)`), and
parses a JSON value the way zod's `safeParse` does: it returns the parsed value (text trimmed, defaults filled
in, unknown keys dropped) or raises `ZodIssue` for the first problem, with zod's message and the path to it.
zod reports every problem; the API only ever shows the first, which is the first one met in zod's order (the
shape's keys in turn, and each value's checks in the order they were written).

Absent values are `MISSING` (JavaScript's undefined): a key that isn't there is not the same as one set to null.
"""

import enum
import math
import re
from collections.abc import Callable, Sequence
from typing import Any, Final, Self

from server_py.shared.js import json_stringify, trim


class Missing(enum.Enum):
    """JavaScript's undefined: a value that was never given."""

    MISSING = "missing"


MISSING: Final = Missing.MISSING

Path = tuple[str | int, ...]


class ZodIssue(Exception):  # noqa: N818 (one zod issue, as zod names it)
    def __init__(self, message: str, path: Path = ()) -> None:
        super().__init__(message)
        self.message = message
        self.path = path

    @property
    def field(self) -> str | None:
        """The dotted path the API reports ("items.1.lifespanDays"), or None for the value itself."""
        return ".".join(str(part) for part in self.path) or None


def parsed_type(value: object) -> str:
    """zod's name for a value's type, as its messages say it ("received null", "received array")."""
    if value is MISSING:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float):
        return "NaN" if isinstance(value, float) and math.isnan(value) else "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def _received(value: object) -> str:
    # zod writes Infinity and -Infinity as themselves.
    if isinstance(value, float) and math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    return parsed_type(value)


def _invalid_type(expected: str, value: object) -> str:
    return f"Invalid input: expected {expected}, received {_received(value)}"


Message = str | None
"""A schema's own message, or None for zod's default wording."""


class Schema:
    """A zod schema: `parse` returns the parsed value or raises the first ZodIssue."""

    def parse(self, value: Any, path: Path = ()) -> Any:
        raise NotImplementedError

    def optional(self) -> "Schema":
        return Optional(self)

    def nullable(self) -> "Schema":
        return Nullable(self)

    def default(self, value: object) -> "Schema":
        return Default(self, value)

    def transform(self, fn: Callable[[Any], Any]) -> "Schema":
        return Transform(self, fn)

    def pipe(self, then: "Schema") -> "Schema":
        return Pipe(self, then)

    def refine(self, check: Callable[[Any], bool], message: Message = None, path: Path = ()) -> "Schema":
        return Refine(self, check, message, path)

    def accepts_missing(self) -> bool:
        """Whether an absent key is fine (optional, or has a default)."""
        return False


class Optional(Schema):
    def __init__(self, inner: Schema) -> None:
        self.inner = inner

    def parse(self, value: Any, path: Path = ()) -> Any:
        return MISSING if value is MISSING else self.inner.parse(value, path)

    def accepts_missing(self) -> bool:
        return True


class Nullable(Schema):
    def __init__(self, inner: Schema) -> None:
        self.inner = inner

    def parse(self, value: Any, path: Path = ()) -> Any:
        return None if value is None else self.inner.parse(value, path)

    def accepts_missing(self) -> bool:
        return self.inner.accepts_missing()


class Default(Schema):
    def __init__(self, inner: Schema, value: object) -> None:
        self.inner = inner
        self.value = value

    def parse(self, value: Any, path: Path = ()) -> Any:
        # zod gives the default as it is, without parsing it.
        return self.value if value is MISSING else self.inner.parse(value, path)

    def accepts_missing(self) -> bool:
        return True


class Transform(Schema):
    def __init__(self, inner: Schema, fn: Callable[[Any], Any]) -> None:
        self.inner = inner
        self.fn = fn

    def parse(self, value: Any, path: Path = ()) -> Any:
        return self.fn(self.inner.parse(value, path))

    def accepts_missing(self) -> bool:
        return self.inner.accepts_missing()


class Pipe(Schema):
    def __init__(self, first: Schema, then: Schema) -> None:
        self.first = first
        self.then = then

    def parse(self, value: Any, path: Path = ()) -> Any:
        return self.then.parse(self.first.parse(value, path), path)

    def accepts_missing(self) -> bool:
        return self.first.accepts_missing()


class Refine(Schema):
    def __init__(self, inner: Schema, check: Callable[[Any], bool], message: Message, path: Path) -> None:
        self.inner = inner
        self.check = check
        self.message = message
        self.path = path

    def parse(self, value: Any, path: Path = ()) -> Any:
        parsed = self.inner.parse(value, path)
        if not self.check(parsed):
            raise ZodIssue(self.message or "Invalid input", (*path, *self.path))
        return parsed

    def accepts_missing(self) -> bool:
        return self.inner.accepts_missing()


# zod 4's email pattern (zod/v4/core/regexes.js), used on text that has already been trimmed and lowered.
_EMAIL: Final = re.compile(
    r"(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}"
)


StringCheck = Callable[[str, Path], str]


class String(Schema):
    """z.string(), with its checks and overwrites (trim, toLowerCase) applied in the order they were written."""

    def __init__(self, error: Message = None, checks: Sequence[StringCheck] = ()) -> None:
        self.error = error
        self.checks = tuple(checks)

    def _with(self, check: StringCheck) -> Self:
        return type(self)(self.error, (*self.checks, check))

    def parse(self, value: Any, path: Path = ()) -> Any:
        if not isinstance(value, str):
            raise ZodIssue(self.error or _invalid_type("string", value), path)
        for check in self.checks:
            value = check(value, path)
        return value

    def trim(self) -> Self:
        return self._with(lambda text, _path: trim(text))

    def to_lower(self) -> Self:
        # JavaScript's toLowerCase and Python's lower() use the same Unicode case mappings.
        return self._with(lambda text, _path: text.lower())

    def to_upper(self) -> Self:
        return self._with(lambda text, _path: text.upper())

    def min(self, length: int, message: Message = None) -> Self:
        def check(text: str, path: Path) -> str:
            # zod 4 counts code points (not UTF-16 units, as text.length does), as Python's len does.
            if len(text) < length:
                raise ZodIssue(message or f"Too small: expected string to have >={length} characters", path)
            return text

        return self._with(check)

    def max(self, length: int, message: Message = None) -> Self:
        def check(text: str, path: Path) -> str:
            if len(text) > length:
                raise ZodIssue(message or f"Too big: expected string to have <={length} characters", path)
            return text

        return self._with(check)

    def regex(self, pattern: re.Pattern[str], message: Message = None) -> Self:
        def check(text: str, path: Path) -> str:
            if not pattern.search(text):
                raise ZodIssue(message or f"Invalid string: must match pattern {pattern.pattern}", path)
            return text

        return self._with(check)

    def email(self, message: Message = None) -> Self:
        def check(text: str, path: Path) -> str:
            if not _EMAIL.fullmatch(text):
                raise ZodIssue(message or "Invalid email address", path)
            return text

        return self._with(check)


def string(error: Message = None) -> String:
    return String(error)


def email(error: Message = None) -> String:
    """z.email(): a string that is an email address. One message covers both problems, as `{error}` does."""
    return String(error).email(error)


class Boolean(Schema):
    def __init__(self, error: Message = None) -> None:
        self.error = error

    def parse(self, value: Any, path: Path = ()) -> Any:
        if not isinstance(value, bool):
            raise ZodIssue(self.error or _invalid_type("boolean", value), path)
        return value


def boolean(error: Message = None) -> Boolean:
    return Boolean(error)


class Enum(Schema):
    def __init__(self, values: Sequence[str], error: Message = None) -> None:
        self.values = tuple(values)
        self.error = error

    def parse(self, value: Any, path: Path = ()) -> Any:
        if not isinstance(value, str) or value not in self.values:
            if self.error:
                raise ZodIssue(self.error, path)
            if len(self.values) == 1:
                raise ZodIssue(f"Invalid input: expected {json_stringify(self.values[0])}", path)
            raise ZodIssue(f"Invalid option: expected one of {'|'.join(json_stringify(v) for v in self.values)}", path)
        return value


def enum_of(values: Sequence[str], error: Message = None) -> Enum:
    return Enum(values, error)


class Object(Schema):
    """z.object(shape): keys checked in the shape's order; keys not in the shape are dropped."""

    def __init__(self, shape: dict[str, Schema], error: Message = None) -> None:
        self.shape = shape
        self.error = error

    def parse(self, value: Any, path: Path = ()) -> Any:
        if not isinstance(value, dict):
            raise ZodIssue(self.error or _invalid_type("object", value), path)
        parsed: dict[str, Any] = {}
        for key, schema in self.shape.items():
            result = schema.parse(value.get(key, MISSING), (*path, key))  # pyright: ignore[reportUnknownMemberType]
            if result is not MISSING:
                parsed[key] = result
        return parsed

    def partial(self) -> "Object":
        return Object({key: schema.optional() for key, schema in self.shape.items()}, self.error)


def object_of(shape: dict[str, Schema], error: Message = None) -> Object:
    return Object(shape, error)
