"""Fills the {placeholders} in a sentence from shared/data (shared/src/template.ts)."""

import re

from server_py.shared.js import number_text

_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")


def fill_template(template: str, values: dict[str, str | int | float] | None = None) -> str:
    """A placeholder with no value is left as it is, so a missing value shows up in a test."""
    given = values or {}

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in given:
            return match.group(0)
        value = given[key]
        return value if isinstance(value, str) else number_text(value)

    return _PLACEHOLDER.sub(replace, template)
