"""Pydantic request models whose fields are checked by the zod-equivalent schemas in zod.py.

Pydantic's own checks word their errors differently and stop in a different order, so each field hands its
value to the matching zod schema instead (`zod(...)`), and the model reports zod's first issue. Fields are
written in the zod shape's order, which is the order zod checks them in.
"""

from collections.abc import Callable
from typing import Any, ClassVar, Self, cast

from pydantic import BaseModel, ConfigDict, Field, PlainValidator, ValidationError
from pydantic_core import PydanticCustomError

from server_py.schemas.zod import MISSING, Object, Path, Schema, ZodIssue


def _validator(schema: Schema) -> Callable[[Any], Any]:
    def validate(value: Any) -> Any:
        try:
            return schema.parse(value)
        except ZodIssue as issue:
            raise PydanticCustomError("zod", "{message}", {"message": issue.message, "path": issue.path}) from None

    return validate


def zod(schema: Schema, *, alias: str | None = None) -> Any:
    """A model field checked by `schema`. An absent key reaches the schema as MISSING, as undefined reaches zod."""
    info = Field(default=MISSING, validate_default=True, alias=alias)
    info.metadata.append(PlainValidator(_validator(schema)))
    return info


class RequestModel(BaseModel):
    """A request body, query or path, parsed as `schema.safeParse(value ?? {})` in validate.ts."""

    model_config = ConfigDict(extra="ignore", frozen=True, arbitrary_types_allowed=True)

    # The model's own error (z.object's `{error}`), for a value that isn't an object at all.
    object_error: ClassVar[str | None] = None
    # `.refine(check, message)` on the whole object: checked on the parsed data once every field is fine.
    refinements: ClassVar[tuple[tuple[Callable[[dict[str, Any]], bool], str], ...]] = ()

    @classmethod
    def parse_input(cls, value: object, path: Path = (), *, root: bool = True) -> Self:
        """The parsed model, or ZodIssue for the first problem. At the root a missing value counts as an empty
        object (validate.ts parses `req[source] ?? {}`); a nested one doesn't."""
        if root and (value is None or value is MISSING):
            value = {}
        if not isinstance(value, dict):
            Object({}, cls.object_error).parse(value, path)
        try:
            parsed = cls.model_validate(value)
        except ValidationError as error:
            first = error.errors()[0]
            context = first.get("ctx") or {}
            # An absent key is reported under the field's Python name; the API uses the JSON one.
            field, *rest = first["loc"]
            info = cls.model_fields.get(str(field))
            name = info.alias if info and info.alias else field
            location = (*path, name, *rest, *context.get("path", ()))
            raise ZodIssue(context.get("message", first["msg"]), location) from None
        for check, message in cls.refinements:
            if not check(parsed.data()):
                raise ZodIssue(message, path)
        return parsed

    def data(self) -> dict[str, Any]:
        """What zod's parse returns: every field that has a value, under its JSON name, in the shape's order."""
        values: dict[str, Any] = {}
        for name, info in type(self).model_fields.items():
            value = getattr(self, name)
            if value is not MISSING:
                values[info.alias or name] = _plain(value)
        return values

    def given(self, name: str) -> bool:
        """Whether the request had this field (zod's `!== undefined`)."""
        return getattr(self, name) is not MISSING


def _plain(value: Any) -> Any:
    if isinstance(value, RequestModel):
        return value.data()
    if isinstance(value, list):
        return [_plain(item) for item in cast(list[Any], value)]
    return value


class ModelSchema(Schema):
    """A nested object checked by its own request model (one row of a bulk add, say)."""

    def __init__(self, model: type[RequestModel]) -> None:
        self.model = model

    def parse(self, value: Any, path: Path = ()) -> Any:
        return self.model.parse_input(value, path, root=False)
