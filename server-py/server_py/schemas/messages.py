"""The validation messages, word for word (shared/data/validation-messages.json, which schemas.ts reads as
`MESSAGES`)."""

from typing import Any, Final

from server_py.shared.data import load

_DATA: Final[dict[str, Any]] = load("validation-messages")


def message(key: str) -> str:
    """One message, by its key in `MESSAGES`; KeyError for a key that isn't there."""
    if key == "description":
        raise KeyError(key)
    value = _DATA[key]
    assert isinstance(value, str)
    return value
