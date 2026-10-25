"""What Mongoose does for the TypeScript server's models, done by hand for PyMongo (docs/PYTHON_MIGRATION.md §4).

- Collections and indexes: the same names, keys and options Mongoose creates, so neither server's start-up ever
  drops the other's indexes. `ensure_indexes` is Mongoose's autoIndex (create what is missing);
  `sync_indexes` is `Model.syncIndexes()` (also drop what the model no longer defines).
- Documents: `Document` holds a stored document with the model's defaults filled in, as Mongoose fills them
  when it reads. `save` writes what changed as dotted `$set` paths, exactly as `doc.save()` does: the fields you
  changed plus `updatedAt`, and also any default that was missing from the stored document (Mongoose writes
  those too, without touching `updatedAt`). Defaults of null are filled in but never written, as in Mongoose.

Only models (and the connection in db.py) talk to MongoDB directly.
"""

import copy
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, cast

from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection

from server_py import db
from server_py.services import clock
from server_py.shared.js import number_text, utf16_length, utf16_slice


@dataclass(frozen=True)
class Index:
    """One index: its keys in order, and the options Mongoose compares (unique, TTL)."""

    keys: tuple[tuple[str, int], ...]
    unique: bool = False
    expire_after_seconds: int | None = None

    @property
    def name(self) -> str:
        """MongoDB's default name, which is what Mongoose ends up with: "userId_1_date_-1"."""
        return "_".join(f"{key}_{direction}" for key, direction in self.keys)

    def options(self) -> dict[str, Any]:
        options: dict[str, Any] = {}
        if self.unique:
            options["unique"] = True
        if self.expire_after_seconds is not None:
            options["expireAfterSeconds"] = self.expire_after_seconds
        return options

    def matches(self, existing: Mapping[str, Any]) -> bool:
        """Mongoose's isIndexEqual: the same keys in the same order, and the same unique, sparse, TTL, partial
        filter and collation options."""
        if list(existing["key"].items()) != list(self.keys):
            return False
        wanted = self.options()
        for option in ("unique", "partialFilterExpression", "sparse", "expireAfterSeconds", "collation"):
            if (option in wanted or option in existing) and wanted.get(option) != existing.get(option):
                return False
        return True


def index(*keys: tuple[str, int], unique: bool = False, expire_after_seconds: int | None = None) -> Index:
    return Index(keys, unique, expire_after_seconds)


@dataclass(frozen=True)
class Model:
    """A Mongoose model: its collection (the pluralised, lower-case model name) and indexes."""

    name: str
    collection_name: str
    indexes: tuple[Index, ...] = ()
    # Mongoose's shardKey option: these fields of the document are added to the filter of every save.
    shard_key: tuple[str, ...] = ()

    def collection(self) -> AsyncCollection[dict[str, Any]]:
        return db.database()[self.collection_name]


async def _existing_indexes(model: Model) -> list[Mapping[str, Any]]:
    cursor = await model.collection().list_indexes()
    return [entry async for entry in cursor if entry["name"] != "_id_"]


async def ensure_indexes(model: Model) -> None:
    """Create the model's indexes that don't exist yet (Mongoose's autoIndex, when a model is first used)."""
    existing = await _existing_indexes(model) if model.collection_name in await _collection_names() else []
    for wanted in model.indexes:
        if not any(wanted.matches(entry) for entry in existing):
            await model.collection().create_index(list(wanted.keys), name=wanted.name, **wanted.options())


async def sync_indexes(model: Model) -> None:
    """`Model.syncIndexes()`: drop the indexes the model doesn't define (or defines differently), then create
    the missing ones."""
    existing = await _existing_indexes(model) if model.collection_name in await _collection_names() else []
    for entry in existing:
        if not any(wanted.matches(entry) for wanted in model.indexes):
            await model.collection().drop_index(entry["name"])
    await ensure_indexes(model)


async def _collection_names() -> list[str]:
    return await db.database().list_collection_names()


class DocumentValidationError(Exception):
    """Mongoose's ValidationError: a schema rule (maxlength, say) that the request schema didn't catch. The API
    answers 400 VALIDATION_ERROR with the first path's message."""

    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("; ".join(errors.values()))
        self.errors = errors


def check_length(path: str, value: str, minimum: int, maximum: int) -> str | None:
    """Mongoose's minlength and maxlength for a string, which count UTF-16 units (text.length): the message, or
    None when it fits."""
    length = utf16_length(value)
    if minimum <= length <= maximum:
        return None
    # Mongoose shortens a long value in its message to its first 30 units.
    shown = utf16_slice(value, 30) + "..." if length > 30 else value
    if length > maximum:
        return f"Path `{path}` (`{shown}`, length {length}) is longer than the maximum allowed length ({maximum})."
    return f"Path `{path}` (`{shown}`, length {length}) is shorter than the minimum allowed length ({minimum})."


def new_id() -> ObjectId:
    return ObjectId()


def as_object_id(value: str | ObjectId) -> ObjectId:
    """Mongoose's cast of an id: ValueError (a CastError there, so a 500) when it isn't one."""
    if isinstance(value, ObjectId):
        return value
    if not ObjectId.is_valid(value) or len(value) != 24:
        raise ValueError(f'Cast to ObjectId failed for value "{value}"')
    return ObjectId(value)


Default = Callable[[], Any] | str | int | float | bool | None
"""A default value, or a function giving a fresh one (like `() => new Types.ObjectId()`)."""


def _value(default: Default) -> Any:
    return default() if callable(default) else default


@dataclass
class Document:
    """A stored document, with `defaults` (dotted path → default) filled in where the stored one has nothing."""

    stored: dict[str, Any]
    data: dict[str, Any] = field(init=False)
    # The dotted paths that were filled from a default, and so are written on the next save.
    defaulted: set[str] = field(init=False, default_factory=set[str])
    # Those filled with a null default, which are not.
    null_defaults: set[str] = field(init=False, default_factory=set[str])

    defaults: Mapping[str, Default] = field(default_factory=dict[str, Default], repr=False)

    def __post_init__(self) -> None:
        self.data = copy.deepcopy(self.stored)
        for path, default in self.defaults.items():
            *parents, leaf = path.split(".")
            parent: dict[str, Any] | None = self.data
            for part in parents:
                child = parent.setdefault(part, {})
                # A stored value that isn't a sub-document is left as it is.
                parent = cast(dict[str, Any], child) if isinstance(child, dict) else None
                if parent is None:
                    break
            if parent is not None and leaf not in parent:
                value = _value(default)
                parent[leaf] = value
                (self.defaulted if value is not None else self.null_defaults).add(path)

    @property
    def id(self) -> ObjectId:
        return self.stored["_id"]

    def get(self, path: str) -> Any:
        value: Any = self.data
        for part in path.split("."):
            if not isinstance(value, dict):
                return None
            value = value.get(part)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        return value  # pyright: ignore[reportUnknownVariableType]

    def set(self, path: str, value: object) -> None:
        parent: Any = self.data
        *parents, leaf = path.split(".")
        for part in parents:
            parent = parent.setdefault(part, {})
        parent[leaf] = value

    def unset(self, path: str) -> None:
        """Setting a path to undefined in Mongoose: the next save removes it ($unset)."""
        parent: dict[str, Any] = self.data
        *parents, leaf = path.split(".")
        for part in parents:
            child = parent.get(part)
            if not isinstance(child, dict):
                return
            parent = cast(dict[str, Any], child)
        parent.pop(leaf, None)

    def __getitem__(self, path: str) -> Any:
        return self.get(path)

    def __setitem__(self, path: str, value: object) -> None:
        self.set(path, value)


def _leaves(document: Mapping[str, Any], prefix: str = "") -> dict[str, Any]:
    """Every value that isn't itself a sub-document, by dotted path."""
    leaves: dict[str, Any] = {}
    for key, value in document.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict) and value:
            leaves.update(_leaves(value, f"{path}."))  # pyright: ignore[reportUnknownArgumentType]
        else:
            leaves[path] = value
    return leaves


def modified_paths(document: Document) -> set[str]:
    """The paths a save would change because they were set (not defaults filled in when reading)."""
    before = _leaves(document.stored)
    after = _leaves(document.data)
    changed = {path for path, value in after.items() if path not in before or before[path] != value}
    removed = {path for path in before if path not in after}
    filled = document.defaulted | document.null_defaults
    return {path for path in changed | removed if path not in filled}


async def save(model: Model, document: Document, *, now: Callable[[], datetime] = clock.system_now) -> None:
    """`doc.save()` on a document that was read: $set what differs from what is stored, $unset what was removed,
    and bump updatedAt when anything was really changed. Nothing is written when nothing differs. `now` is the
    model's timestamp clock (the computer's, unless the model says otherwise)."""
    before = _leaves(document.stored)
    after = _leaves(document.data)
    changes: dict[str, Any] = {}
    modified = False
    for path, value in after.items():
        if path in before and before[path] == value:
            continue
        if value is None and path in document.null_defaults:
            # A null default that was filled in when reading: Mongoose never writes it.
            continue
        changes[path] = value
        if path not in document.defaulted:
            modified = True
    removed = {path: "" for path in before if path not in after}
    if not changes and not removed:
        return
    if modified or removed:
        changes["updatedAt"] = now()
        document.data["updatedAt"] = changes["updatedAt"]
    update: dict[str, Any] = {"$set": changes}
    if removed:
        update["$unset"] = removed
    query = {"_id": document.id, **{key: document.stored.get(key) for key in model.shard_key}}
    result = await model.collection().update_one(query, update)
    if result.matched_count == 0:
        raise LookupError(f"No document found for _id {document.id} on model {model.name}")
    document.stored = copy.deepcopy(document.data)
    document.defaulted = set()
    document.null_defaults = set()


class _NoDefault:
    def __repr__(self) -> str:
        return "NoDefault"


NoDefault: Any = _NoDefault()
"""In a schema list: the field has no default, so it is left out when no value is given."""

Schema = tuple[tuple[str, Any], ...]
"""A model's top-level fields in the order Mongoose writes them, each with its default (or NoDefault)."""


def new_document(
    schema: Schema, values: Mapping[str, Any], *, now: datetime, insert_many: bool = False
) -> dict[str, Any]:
    """A new document laid out as `Model.create` writes it: _id, every schema field that has a value or a
    default, then the timestamps and __v (insertMany writes __v before the timestamps)."""
    document: dict[str, Any] = {"_id": new_id()}
    for name, default in schema:
        if name in values:
            document[name] = values[name]
        elif default is not NoDefault:
            document[name] = _value(default)
    if insert_many:
        document.update({"__v": 0, "createdAt": now, "updatedAt": now})
    else:
        document.update({"createdAt": now, "updatedAt": now, "__v": 0})
    return document


Rule = Callable[[str, Any], str | None]
"""One Mongoose validator for one path: the message when the value breaks it, else None."""


def required() -> Rule:
    # An empty string counts as missing for a required string, as in Mongoose.
    return lambda path, value: f"Path `{path}` is required." if value is None or value == "" else None


def length(minimum: int, maximum: int) -> Rule:
    return lambda path, value: check_length(path, value, minimum, maximum) if isinstance(value, str) else None


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def at_least(limit: float) -> Rule:
    def rule(path: str, value: Any) -> str | None:
        if _is_number(value) and value < limit:
            return f"Path `{path}` ({number_text(value)}) is less than minimum allowed value ({number_text(limit)})."
        return None

    return rule


def at_most(limit: float) -> Rule:
    def rule(path: str, value: Any) -> str | None:
        if _is_number(value) and value > limit:
            return f"Path `{path}` ({number_text(value)}) is more than maximum allowed value ({number_text(limit)})."
        return None

    return rule


def one_of(values: tuple[Any, ...]) -> Rule:
    def rule(path: str, value: Any) -> str | None:
        if value is not None and value not in values:
            return f"`{value}` is not a valid enum value for path `{path}`."
        return None

    return rule


def check(test: Callable[[Any], bool], message: str | None = None) -> Rule:
    """A custom validator; without a message, Mongoose's general one."""

    def rule(path: str, value: Any) -> str | None:
        if value is None or test(value):
            return None
        shown = number_text(value) if _is_number(value) else value
        return message or f"Validator failed for path `{path}` with value `{shown}`"

    return rule


Rules = Mapping[str, tuple[Rule, ...]]
"""Each path's validators, in the schema's path order and each path's option order."""


def validate(rules: Rules, document: Mapping[str, Any], paths: set[str] | None = None) -> None:
    """Mongoose's validation: every path (on create) or the modified ones (on save). DocumentValidationError
    with each failing path's first message, in path order."""
    errors: dict[str, str] = {}
    for path, path_rules in rules.items():
        if paths is not None and path not in paths:
            continue
        value = document.get(path)
        for rule in path_rules:
            if problem := rule(path, value):
                errors[path] = problem
                break
    if errors:
        raise DocumentValidationError(errors)
