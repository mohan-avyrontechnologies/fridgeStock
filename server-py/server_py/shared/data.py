"""The JSON in shared/data, which the TypeScript code reads too: the catalog, category defaults, banned phrases
and all wording. Each file is read once.

The folder is found next to this repository's `shared/` package. `FRIDGE_STOCK_SHARED_DATA` can point
elsewhere, for a deployment that copies the files into the build.
"""

import json
import os
from functools import cache
from pathlib import Path
from typing import Any, cast

_DEFAULT_DIR = Path(__file__).resolve().parents[3] / "shared" / "data"


def data_dir() -> Path:
    return Path(os.environ.get("FRIDGE_STOCK_SHARED_DATA") or _DEFAULT_DIR)


@cache
def load(name: str) -> dict[str, Any]:
    """One of shared/data/<name>.json."""
    with (data_dir() / f"{name}.json").open(encoding="utf-8") as file:
        return cast(dict[str, Any], json.load(file))
