# Cook First API in Python (`server-py`)

The Python rewrite of the API in `server/`, built in phases on the `python-backend` branch. To every client the
switch is meant to be invisible: same routes, same bodies, same data. The full plan, and which phase is done, is
in [docs/PYTHON_MIGRATION.md](../docs/PYTHON_MIGRATION.md).

**Status: Phase 0.** No routes yet. What exists is the Python port of the shared logic (dates, alerts,
barcodes, wording, the catalog, `estimateExpiry`, the priority engine and the server's wording), which passes
every case in `shared/test-cases`, and the local database script.

## Set up

You need [uv](https://docs.astral.sh/uv/) and the repository's npm packages (`npm install` at the root; the
local database script uses one of them).

```sh
cd server-py
uv sync          # creates .venv with Python 3.12 and every dependency, from uv.lock
```

## Everyday commands

From the repository root:

| Command | What it does |
|---|---|
| `npm run test:py` | Runs pytest. |
| `npm run lint:py` | ruff (lint and format check) and pyright (strict). |
| `npm run db:py` | Starts the local MongoDB, which **keeps its data** in `server-py/.data` (gitignored) on port 27028. |
| `npm run db:py:empty` | Starts an **empty** throwaway MongoDB for tests, deleted when it stops. |

Or inside `server-py`: `uv run pytest`, `uv run pytest tests/test_shared_cases.py`, `uv run ruff check .`,
`uv run ruff format .`, `uv run pyright`.

On a PC with little free memory, run one test file at a time (`uv run pytest tests/<file>.py`); CI runs the
whole suite.

## Shared data and cases

- `shared/data/*.json`: the catalog, category defaults, banned phrases, the day/month order of each locale and
  every sentence the server sends. The TypeScript code reads the same files.
- `shared/test-cases/*.json`: inputs and expected outputs that both `tests/test_shared_cases.py` and the
  TypeScript suites must pass. `validation.json` is written from the zod schemas by
  `npm run cases:validation -w shared`; each Pydantic schema is checked against it once it is ported
  (`server_py/schemas/__init__.py` lists the ones still pending).

## Layout

```
server_py/
  shared/        Python port of shared/src (enums, dates, alerts, barcode, wording, reference, estimate)
  services/      one module per TypeScript service (priority_engine so far)
  config/        settings and fixed values (urgency threshold)
  schemas/       Pydantic request schemas (pending, phase by phase)
  messages.py    the server's wording, from shared/data/messages.json (server/src/copy.ts)
scripts/
  dev-mongo.mjs  the local embedded MongoDB (persistent, or --empty)
tests/           pytest
```
