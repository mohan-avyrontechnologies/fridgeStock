# FridgeStock API in Python (`server-py`)

The Python rewrite of the API in `server/`, built in phases on the `python-backend` branch. To every client the
switch is meant to be invisible: same routes, same bodies, same data. The full plan, and which phase is done, is
in [docs/PYTHON_MIGRATION.md](../docs/PYTHON_MIGRATION.md).

**Status: Phase 2.** The server runs, with the foundation every later route stands on: settings, the MongoDB
connection and start-up migrations, Express's HTTP behaviour (helmet headers, CORS, body limits and encodings,
ETags, the error format), logins (JWT and bcrypt, interchangeable with the Node server's), the auth rate limit,
and these routes: `GET /health`, `POST /auth/register`, `POST /auth/login`, `GET` and `PUT /auth/me`,
`GET /push/config`, `GET /ai/status`, and food: every `/foods` route except photos, `/foods/bulk`,
`/foods/fridgestock`, `/favourites`, `/usage` and `/suggestions/lifespans` (with reminders scheduled and
delivered in the app). Everything else under `/api` is a 401 without a login and a 404 with
one, until its phase.

## Set up

You need [uv](https://docs.astral.sh/uv/) and the repository's npm packages (`npm install` at the root; the
local database script and some tests use them).

```sh
cd server-py
uv sync          # creates .venv with Python 3.12 and every dependency, from uv.lock
```

Settings are the TypeScript server's (`server/.env.example`); copy `.env.example` to `.env` for local ones.

## Everyday commands

From the repository root:

| Command | What it does |
|---|---|
| `npm run dev:server-py` | Starts the API on `PORT` (4000 unless set; use 4001 to run it next to the Node server), reloading on changes. With no `MONGO_URI` it starts its own MongoDB, which keeps its data in `server-py/.data`. |
| `npm run test:py` | Runs pytest. |
| `npm run compare:py` | Runs one journey on the Node server and on the Python server and reports any difference in a response or a stored document. |
| `npm run lint:py` | ruff (lint and format check) and pyright (strict). |
| `npm run db:py` | Starts the local MongoDB on its own, which **keeps its data** in `server-py/.data` (gitignored) on port 27028. |
| `npm run db:py:empty` | Starts an **empty** throwaway MongoDB for tests, deleted when it stops. |

Or inside `server-py`: `uv run python -m server_py`, `uv run pytest`, `uv run pytest -m phase1`,
`uv run ruff check .`, `uv run ruff format .`, `uv run pyright`.

On a PC with little free memory, run one phase's tests at a time (`uv run pytest -m phase1`) or one file
(`uv run pytest tests/<file>.py`); CI runs the whole suite. The tests start one empty MongoDB for the run
(or use `TEST_MONGO_URI`), and empty it before each test.

## Shared data and cases

- `shared/data/*.json`: the catalog, category defaults, banned phrases, the day/month order of each locale,
  every sentence the server sends and every validation message. The TypeScript code reads the same files.
- `shared/test-cases/*.json`: inputs and expected outputs that both `tests/test_shared_cases.py` and the
  TypeScript suites must pass. `validation.json` is written from the zod schemas by
  `npm run cases:validation -w shared`; each Pydantic schema is checked against it once it is ported
  (`server_py/schemas/__init__.py` lists the ones still pending).

## Layout

```
server_py/
  main.py          the app: middleware, routes, start-up (connect, indexes, migrations)
  __main__.py      python -m server_py: uvicorn on PORT
  config/          settings (env.py) and fixed values: AI limits, native origins, urgency threshold
  db.py            the MongoDB connection, and the embedded one in development
  models/          one module per collection: indexes, defaults, Mongoose-compatible documents; migrations.py
  schemas/         request schemas: Pydantic models checked by zod.py, a port of the zod pieces they use
  services/        one module per TypeScript service
  controllers/     thin: request in, service call, response out
  middleware/      Express's HTTP behaviour (http.py), auth, validation, rate limits
  routes/          index.py lists every route in index.ts's order; router.py routes them as Express does
  shared/          Python port of shared/src (enums, dates, alerts, barcode, wording, reference, estimate) and
                   JavaScript's text and JSON rules (js.py)
  messages.py      the server's wording, from shared/data/messages.json (server/src/copy.ts)
scripts/
  dev-mongo.mjs    the local embedded MongoDB (persistent, or --empty)
tests/             pytest, one group per phase (-m phase1)
typings/           type hints for packages that ship without them (brotli)
```
