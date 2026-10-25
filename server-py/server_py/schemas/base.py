"""Pydantic request models whose fields are checked by the zod-equivalent schemas in zod.py.

Pydantic's own checks word their errors differently and stop in a different order, so each field hands its
value to the matching zod schema instead (`zod(...)`), and the model reports zod's first issue. Fields are
written in the zod shape's order, which is the order zod checks them in.
"""

from collections.abc import Callable
from typing import Any, ClassVar, Self

from pydantic import BaseModel, ConfigDict, Field, PlainValidator, ValidationError
from pydantic_core import PydanticCustomError

from server_py.schemas.zod import MISSING, Object, Schema, ZodIssue, parsed_type


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

    @classmethod
    def parse_input(cls, value: object) -> Self:
        """The parsed model, or ZodIssue for the first problem."""
        if value is None or value is MISSING:
            value = {}
        if not isinstance(value, dict):
            Object({}, cls.object_error).parse(value)
            raise ZodIssue(f"Invalid input: expected object, received {parsed_type(value)}")
        try:
            return cls.model_validate(value)
        except ValidationError as error:
            first = error.errors()[0]
            context = first.get("ctx") or {}
            raise ZodIssue(context.get("message", first["msg"]), (*first["loc"], *context.get("path", ()))) from None

    def data(self) -> dict[str, Any]:
        """What zod's parse returns: every field that has a value, under its JSON name, in the shape's order."""
        values: dict[str, Any] = {}
        for name, info in type(self).model_fields.items():
            value = getattr(self, name)
            if value is not MISSING:
                values[info.alias or name] = value
        return values
