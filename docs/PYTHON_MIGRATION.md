# Python server migration plan

Status: **approved on 2026-10-23**, with the five recommended answers in §11 and two additions: `JOBS_ENABLED`
(§6, §10) and a persistent local database with a separate empty one for tests (§8).

**Revised on 2026-10-27: the Python server uses PostgreSQL, not MongoDB** (§11, decisions 6–14). Nothing is live,
so no data is migrated. The Node server stays on MongoDB until the switch, and the two servers never share a
database. This revision was **approved on 2026-10-27**, with no tables for custom catalog foods or leftover
ingredients (§4) and the crash gap on reminders stated as accepted (§6).

## Progress

| Phase | State |
|---|---|
| 0. Shared data | **Done** (see the notes below). |
| 1. Foundation | **Done** on MongoDB (see the notes below). Its data access is redone in Phase P. |
| 2. Foods | **Done** on MongoDB (see the notes below). Its data access is redone in Phase P. |
| **P. PostgreSQL** | **Next.** The database, the tables, Alembic, the repository layer, and Phases 1–2 moved onto them (§6). |
| 3–8 | Not started. They are built on PostgreSQL. |

**What Phase 0 found and changed, compared with the plan:**
- **The day/month order of a printed date was machine-dependent.** For a language with no locale data (`xx`), Node used the computer's own locale. Node, Python's Babel and browsers also disagree on 16 of 920 locales (for example `en-CA`), because they carry different CLDR versions. So no locale library is used. Both languages look the tag up in `shared/data/date-order.json` (recorded from CLDR 48), and Babel isn't a dependency.
- **The server's wording module is `server_py/messages.py`, not `copy.py`**, because `copy` is a Python standard-library module.
- **Writes could be lost on Windows.** Stopping the embedded database there ends `mongod` at once, which lost writes made just before. `dev-mongo.mjs` now flushes them first (`fsync`), and a test restarts it and reads the data back.
- **JavaScript text rules are copied explicitly** (`server_py/shared/js.py`): `trim()` and `\s` whitespace, ASCII-only `\d` and `\b`, `$` never matching before a final newline, and how numbers are written. The shared cases include each difference.
- **`npm run dev:server-py`** arrives with the app in Phase 1. Phase 0 has `npm run db:py`, `db:py:empty`, `test:py` and `lint:py`.
- **Validation cases:** `server_py/schemas/__init__.py` lists the schemas not yet ported (`PENDING`). A test fails if a schema is in neither list. Each phase moves its routes' schemas over.

**What Phase 1 found and changed, compared with the plan:**
- **Every Phase 1 answer was checked against the Node server itself.** The same 38 raw HTTP requests (health, unknown paths, wrong methods, CORS and preflights, every kind of bad body, compressed bodies, rate limits, bad tokens) were sent to both servers, and all 38 answers were identical: status, body, ETag, Vary, CORS, helmet and `RateLimit` headers. The expected values in `tests/test_http.py` were recorded from Node.
- **zod 4.6 counts string lengths in code points; Mongoose counts UTF-16 units.** So a name of 26 emoji passes `registerSchema` (26 characters) and is then refused by the User model's `maxlength: 50` (52 units), with Mongoose's own message ("Path \`name\` (\`…\`, length 52) is longer than the maximum allowed length (50)."). The Python server does both checks the same way (`models/user.py`, `models/base.py: check_length`). `validation.json` had no such input, which is how Phase 0 missed it: the case generator now adds emoji strings to every text field (1,494 cases).
- **No PyJWT.** Tokens are signed and checked with the standard library's `hmac`, as `jsonwebtoken` does it, and are byte-for-byte the tokens Node signs (a test signs one with `jsonwebtoken` and compares). PyJWT also refuses tokens Node accepts, such as one with a fractional `exp`. `JWT_EXPIRES_IN` is read as the `ms` package reads it (a bare `3600` is milliseconds).
- **No slowapi.** The limiter is express-rate-limit's memory store ported directly: a fixed window per client that starts with its first request, one count shared by all the routes using the same limiter, and the draft-8 `RateLimit`/`RateLimit-Policy` headers with the same partition key (`pk`). The client is the last `X-Forwarded-For` entry (`trust proxy` = 1), with IPv6 counted per /56.
- **Routing is Express's, not FastAPI's** (`routes/router.py`). Paths match without regard to case and with one optional trailing slash, against the path as sent (`/api/heal%74h` is not `/api/health`); HEAD runs GET; every OPTIONS request is a preflight. As `router.use(requireAuth)` does, an unknown path or wrong method under `/api` is a 401 without a login and a 404 with one. FastAPI still hosts the app and describes every route in its OpenAPI document (`app.openapi()`, for the drift check), but serves no `/docs` or `/openapi.json`, which are 404s on Node.
- **Request validation never produces a 422.** Each request model is Pydantic, but its fields hand their values to `schemas/zod.py`, a small port of the zod pieces the schemas use, so messages, order and the first issue are zod's.
- **Responses are written as `JSON.stringify` writes them** (`5`, not `5.0`; lone surrogates escaped) with Express's weak ETag, 304 for a matching `If-None-Match`, and no body for HEAD. `number_text` (Phase 0) was also wrong for whole numbers past 2^53; JavaScript writes 2^60 as `1152921504606847000`.
- **Time zones:** Intl accepts UTC offsets (`+05:30`, `+0530`, `+05`) as well as IANA names in any case, and Node stores whatever the device reports, so `dates.zone` (Phase 0) now reads offsets too. Intl refuses `Factory`.
- **Mongoose's `save()` also writes missing defaults.** Saving an account that predates a field writes that field's default (as dotted `$set` paths, which MongoDB applies in name order) without changing `updatedAt`; a `null` default is never written. `models/base.py` does the same, and a test compares the stored document with the one Mongoose leaves.
- **bcrypt:** Node's bcrypt reads only the first 72 bytes of a password and Python's refuses longer ones, so the bytes are cut the same way. Hashes from Node are checked in a test, and Node checks a Python hash.
- **Bodies compressed with `br` are read too** (body-parser 2 accepts them), so the `brotli` package is a dependency.
- **`MESSAGES` moved to `shared/data/validation-messages.json`**, which `schemas.ts` reads, so the Python schemas use the same file. The wording guard scans it.
- **The start command is `python -m server_py`**, not `uvicorn ... --proxy-headers`: uvicorn's proxy handling and `Server` header are off, because the app reads `X-Forwarded-For` itself, as Express does. `npm run dev:server-py` adds `--reload`.
- **Tests ported:** `auth` (all 13, plus 3 on the name length), and the parts of `api`, `phase1`, `security` and `structure` that need only Phase 1 routes: the error format, the 500, unreadable bodies, the user's fields, removed routes, the migration backfill, the route walk (every route but the public ones is a 401), `docs/API.md` order (checked as an ordered superset until Phase 6), and the layer rules. Their food, favourite and isolation tests need the food routes and move to Phase 2, as does the database validation test for food items. New files cover what the TypeScript server got from its packages: `test_http.py`, `test_tokens.py`, `test_models.py` (indexes and documents recorded from Mongoose), `test_env.py` and `test_config_routes.py`. `pytest -m phase1` runs them.

**What Phase 2 found and changed, compared with the plan:**
- **Every Phase 2 route was run on both servers and compared** (`npm run compare:py`, `server-py/scripts/compare-servers.mjs`). It runs one journey on the Node server and on the Python server, each with its own empty database, and compares every response and every document left in MongoDB, with ids, times and tokens numbered in order of appearance. All 84 checks were identical: the responses, plus 21 food items, 58 reminders, the usage records and the favourites, field for field and in Mongoose's field order. Each later phase adds its routes to the journey.
- **Reminder scheduling and in-app delivery came forward from Phase 4.** Adding, editing, closing and undoing food schedule or cancel its reminders, and `GET /foods` delivers the due ones first, so `schedule_for_household`, `cancel_for_food` and `dispatch_due` are ported now (`services/notification_service.py`). The feed, settings and push stay in Phase 4.
- **Mongoose's model validators are ported too** (`models/base.py: validate`, rules per model). The request schemas count text in code points and Mongoose in UTF-16 units, so 31 emoji pass the 60-character name check and fail the model's `maxlength`. Every answer, message and field matches Node's, including a whole bulk add refused for one such row.
- **Saving writes what Mongoose writes:** `$unset` for a field set to undefined (undo removes `closedAt`), the shard key (`userId`) in the filter of every save, the app's clock for usage records' timestamps, and `__v` before the timestamps for `insertMany`.
- **Sorting with `localeCompare`:** learned lifespans are sorted with ICU's root collation, which Python doesn't have. `shared/js.py: locale_compare_key` copies what matters for food names (base letters first, then accents, then lower case before upper case; ß, æ, œ and ø sort as ss, ae, oe and o; marks before digits before letters), and a test checks it against Node's order for 41 tricky names.
- **`Math.round` and `Number()`:** halves round up in JavaScript and to even in Python, so prices and quantities use `math_round`. Query values are read with JavaScript's `Number()` rules (`"0x3"` is 3, `""` is 0, a repeated key is NaN).
- **Time zones come only from the tzdata package.** On Linux, `available_timezones()` also lists the system's own files (`localtime`, `posix/...`), which Intl refuses; that failed Phase 1's CI. Zone names and rules are now read from the bundled package, the same on every machine.
- **Tests ported:** `foods` (all 26), `phase2` (all 17), `priorityEngine` (all 12), the rest of `api` and `phase1`, the food, history and favourite parts of `security`, and from `rules` everything but the full journey, which covers the Phase 1 and 2 routes (database commands are recorded with PyMongo's command monitoring). Still to come: `security`'s reminder-feed and meal-plan checks (Phases 4 and 6). `pytest -m phase2` runs this phase's tests.

**What the move to PostgreSQL changes in these notes.** Everything about HTTP, validation, wording, tokens,
passwords, rate limits, dates, time zones and JavaScript number and text rules stays. What only existed to write
documents Mongoose could read is removed in Phase P:
- Mongoose's document shape: `__v`, field order, `$set` of missing defaults on save, `$unset`, the shard key in
  filters, `insertMany`'s `__v` order, and Mongoose's index names and `syncIndexes()`.
- The start-up migrations in `models/migrations.py` (household and storage backfills, Date-to-string fields). They
  fixed old MongoDB data, and there is none. The schema starts from one Alembic baseline.
- The comparison of documents left in MongoDB in `compare:py`, and `tests/test_models.py`'s indexes and documents
  recorded from Mongoose. §7 says what replaces them.
- `dev-mongo.mjs` for the Python server. Node keeps its own embedded MongoDB.

**What stays, because the API shows it:** the model validators (`models/base.py: validate`, with UTF-16 lengths and
Mongoose's messages), the bcrypt 72-byte rule, `math_round` and `Number()`, and `locale_compare_key`. They move
out of the database layer into `server_py/rules/`, so services still call them before anything is saved.

Goal: replace the TypeScript API in `server/` with a Python one in `server-py/`, backed by PostgreSQL. To every
client, the change must be invisible. The web app, the Android app and the iOS app stay in TypeScript, Java and
Swift, and their code doesn't change. Existing logins keep working (the same `JWT_SECRET` and bcrypt hashes). No
data is migrated from MongoDB, because nothing is live.

Work happens on the `python-backend` branch. `server/` stays untouched until the switch, apart from the small ID
change in Phase P (§4, "IDs").

## 1. What is being replaced

| | Today (`server/`) |
|---|---|
| Size | About 6,300 lines of TypeScript in 30 test files with about 560 tests (8,100 lines). |
| Runtime | Node 24, Express 5, Mongoose 9, zod 4 (schemas shared with the client from `shared/src/schemas.ts`). |
| Routes | 68 under `/api`, with 4 public. `docs/API.md` is kept equal to the router by a test. |
| Collections | `users`, `fooditems`, `usagerecords`, `notifications`, `pushsubscriptions`, `favourites`, `shoppingitems`, `mealplanentries`, `mealreminderlogs`, `recipeideacaches`, `aiusages`, `invites`, `householdevents`, `usedactiontokens`, plus the GridFS bucket `foodPhotos` (`foodPhotos.files`, `foodPhotos.chunks`). |
| Jobs | `node-cron`: a reminder sweep every 5 minutes and photo clean-up at 03:30, each also run once at start-up. |
| Start-up migrations | `server/src/models/migrations.ts`: household and storage backfills, `meal` default, Date-to-string date fields, and `syncIndexes()` on 9 models. |
| Scripts | `seed.ts` (demo account), `ai-eval.ts` (provider comparison) and `vapid:keys`. |
| Dev database | An embedded MongoDB through `mongodb-memory-server`, so no Docker or `mongod` install is needed. Data goes in `server/.data`, and a throwaway copy is used for E2E (`EPHEMERAL_DB=1`). |
| Settings | `PORT`, `MONGO_URI`, `TEST_MONGO_URI`, `EPHEMERAL_DB`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, `AUTH_RATE_LIMIT`, `VAPID_*`, `FIREBASE_*`, `APNS_BUNDLE_ID`, `PUBLIC_API_URL`, `PRODUCT_LOOKUP_URL`, `PHOTO_CHECK`, `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART`, `GEMINI_TIER`. The Python server reads `DATABASE_URL` and `TEST_DATABASE_URL` in place of the three MongoDB settings (§8). |
| Database after the switch | PostgreSQL 17 or newer, through SQLAlchemy 2.0 (async) and asyncpg, with Alembic migrations. The tables are in §4. |

## 2. Stack

| Need | Python choice |
|---|---|
| Language | Python 3.12+ (CI runs 3.12 and 3.13, as Node runs 20.19 and 24 today). |
| Web | FastAPI on Uvicorn. |
| Validation | Pydantic v2. |
| Database | PostgreSQL 17 or newer (CI runs 17 and 18). SQLAlchemy 2.0 in async mode (`AsyncEngine`, `AsyncSession`) on the asyncpg driver. Tables are declared once in `server_py/db/tables.py`. Only repositories run queries (§3). |
| Schema migrations | Alembic, async `env.py`, one revision per change, starting from a single baseline. `alembic upgrade head` runs before the server starts, under a PostgreSQL advisory lock so two copies never migrate at once. |
| IDs | UUIDv7 primary keys, made by the app (`server_py/db/ids.py`) and returned as strings (§4, "IDs"). |
| Auth | HS256 tokens with the standard library's `hmac` (not PyJWT; see Phase 1's notes) and `bcrypt`. |
| Rate limits | A port of express-rate-limit's memory store (fixed window per client, in memory), not slowapi; see Phase 1's notes. |
| Jobs | APScheduler (`AsyncIOScheduler`, cron triggers). |
| Photos | Pillow, re-encoding to WebP without EXIF or GPS. |
| Push | pywebpush (web) and firebase-admin (FCM for Android and iOS). Both block, so they run in a thread pool. |
| AI | `anthropic` and `google-genai`. |
| HTTP out | httpx (Open Food Facts). |
| Time zones | `zoneinfo` plus the `tzdata` package (Windows has no system time-zone database). |
| Tooling | ruff (lint and format), pyright (strict), pytest with pytest-asyncio, and uv to manage the environment and lock file. |

## 3. Layout

```
server-py/
  pyproject.toml, uv.lock, .env.example, README.md
  server_py/
    main.py               app factory + lifespan (connect, migrate, start jobs)
    config/               env.py, ai.py, features.py, native.py, urgency.py
    db/                   engine.py (engine, sessions, one transaction per request), tables.py, ids.py (UUIDv7)
    records.py            the frozen dataclasses repositories return (UserRecord, FoodRecord, ...)
    repositories/         one module per table group: users, households, foods, usage, favourites,
                          notifications, push, shopping, meal_plan, activity, caches, tokens
    storage/              PhotoStore interface, and postgres.py (bytea) as its first implementation
    rules/                the model validators kept from Phases 1–2 (UTF-16 lengths, Mongoose's messages)
    schemas/              Pydantic models mirroring shared/src/schemas.ts
    services/             one module per TypeScript service, same names
    routes/               one APIRouter per group, same order as routes/index.ts
    middleware/           errors, auth, rate limits, request log, body limits
    jobs/                 reminder sweep, photo and cache clean-up
    shared/               Python port of shared/src: enums, dates, estimate, priority, wording, reference
    messages.py           loads shared/data/messages.json (server/src/copy.ts)
  migrations/             Alembic: env.py, versions/0001_baseline.py, ...
  alembic.ini
  scripts/                seed.py, ai_eval.py, vapid_keys.py
  tests/                  pytest, one file per server/src/tests file, plus contract/
shared/data/              JSON read by both languages
shared/test-cases/        JSON cases both test suites must pass
```

The layer rules: routes → middleware → controllers/route handlers → services → repositories → database.
- **Only `repositories/` and `storage/` import SQLAlchemy** or run SQL. A service never sees a session, a table or a
  statement. It calls repository functions and gets `records.py` dataclasses back, so nothing loads lazily and no
  query is hidden in a service.
- **Transactions belong to the request, not the repository.** `db/engine.py` opens one `AsyncSession` per request
  (and per job run), commits when the handler returns, and rolls back on any error. Repositories receive the
  session; services receive the repositories (one `Repos` bundle per request). So a service that changes three
  tables changes all three or none, as a single request.
- **Photo bytes go through `storage.PhotoStore`** (`put`, `get`, `delete_for_foods`, `delete_uploaded_by`), never
  through a repository, so moving them to object storage later changes one module.
- Nothing calls `datetime.now()` except `services/clock.py`, so database times come from the app's clock, never from
  `now()` in SQL. Tests can then fix the time.
- The structure tests check all of these, as they check the layers today.

## 4. Keeping the API and the data identical

### HTTP behaviour
- **Paths and order:** the same 68 paths under `/api`, registered in the order of `server/src/routes/index.ts`. A test keeps the routes equal to `docs/API.md`, as the TypeScript one does now.
- **Error shape:** `{error: {code, message, field?}}` everywhere. That covers unknown routes (404 `NOT_FOUND`), wrong methods, oversized bodies (413), unreadable bodies (415/400), and anything unexpected (500, with no details).
- **Validation (422 → 400):** FastAPI's 422 becomes 400 `VALIDATION_ERROR`, keeping only the **first** issue. The `field` is the dotted path, as `validate.ts` does.
  - **The messages must match zod's word for word.** That includes zod's own default messages, not only the custom ones in `schemas.ts`.
  - To prove it, a script runs every shared zod schema against a bank of bad inputs and writes `shared/test-cases/validation.json` as `{schema, input, status, message, field}`. The Pydantic models are then tested against the same file.
  - Where Pydantic's built-in checks can't produce zod's wording or order, those fields use custom validators.
- **Body limits:** 20 KB normally and `RECEIPT_BODY_LIMIT` for `/parse/receipt` and `/parse/photo`. The photo upload keeps multer's rules: 1 file, no other fields, and `PRODUCT_PHOTO_MAX_BYTES`.
- **Headers:**
  - The same security headers as helmet, set by middleware.
  - The same CORS origins: `CLIENT_ORIGIN` plus the native app origins.
  - `trust proxy` = 1 hop, so rate limits key on the real client IP.
- **Rate limits:** the same numbers and keys.
  - Auth: 20 per 15 minutes on register, login, `/household/join` and `DELETE /account`, with the `AUTH_RATE_LIMIT` override.
  - 60 per 15 minutes each on push actions, scanning and photo upload.
  - AI: 20 per person per day, stored in `ai_usages`, with reserve and refund.
  - **Response headers:** the IETF draft-8 `RateLimit` and `RateLimit-Policy` headers, with the same partition key.
- **Request log:** method, route, status and time only, never bodies or headers, as now.

### IDs
- **Primary keys are `uuid`, generated by the app as UUIDv7** (RFC 9562) and returned in the API as lower-case
  strings (`"0192f3c4-7b1e-7c2a-9d4e-3f6a8b2c1d00"`), where Node returns 24-hex ObjectId strings.
- **Why v7 and not random v4:** several lists break ties by `_id` (history, the feed, the shopping list, learned
  lifespans, members and the export all sort `createdAt, _id`). An ObjectId follows insertion order, even within one
  millisecond. UUIDv7 does too, if it is generated monotonically (a counter within the same millisecond), which
  `db/ids.py` does. Python 3.12 has no `uuid7()`, and PostgreSQL's `uuidv7()` only exists from version 18, so the
  app makes them. A test generates 10,000 in a tight loop and checks they sort in creation order.
- **An ID that isn't a UUID is "not found",** before any query runs, as Node does for an invalid ObjectId (`404`
  with the same message), so a bad path segment never reaches asyncpg as a cast error.
- **The client:** checked on 2026-10-27. No client code checks, parses, shortens or compares the format of an ID.
  The web app keeps IDs as opaque strings (`/food/:id`, React keys, `FoodThumb`), and the Android and iOS code never
  reads one; they only pass `actionToken`s and URLs through. The tests' MSW fixtures use 24-hex IDs, so Phase P runs
  the client suite once more with every fixture ID swapped for a UUID, to prove it.
- **What does assume ObjectIds: two shared request schemas,** used by the server, not the client:
  `mealPlanEntrySchema.foodIds` and `photoCheckSchema.foodId` in `shared/src/schemas.ts`, with
  `/^[0-9a-f]{24}$/i`. They become one `idSchema` that accepts a 24-hex ObjectId **or** a UUID, with the same message
  (`MESSAGES.mealFoods` and `MESSAGES.photoFood`), and `validation.json` is regenerated with UUID cases.
  - That is the one change to `server/` in Phase P: where Node would get a UUID it can't cast (the meal plan's food
    lookup and the photo check's food), it treats it as a food that doesn't exist, which is what it does today for
    an unknown ObjectId. A Node test sends both kinds.

### Data model (PostgreSQL)

**Conventions, for every table:**
- `id uuid PRIMARY KEY` (UUIDv7). `created_at` and `updated_at` are `timestamptz NOT NULL`, set from the app's
  clock. `updated_at` changes on every update, as Mongoose's timestamps did, so `updatedAt` in responses behaves the
  same.
- **Calendar dates are `date`.** asyncpg returns `datetime.date`, written back as `"YYYY-MM-DD"` in the API, so
  responses don't change. Moments in time are `timestamptz`, written with milliseconds and `Z`, as
  `Date.toJSON()` does.
- **Status values are `text` with a `CHECK (col IN (...))`,** with names like `food_items_status_check`. They are
  generated from the same enums in `shared/data` that the code uses, and a test checks that the CHECK lists in the
  database equal the enums. A new value is one Alembic revision that replaces the CHECK; no type has to be altered.
- **Money is `numeric`.** `food_items.price` is `numeric` with `CHECK (price BETWEEN 0 AND 100000)` and no fixed
  scale, because Node keeps the price exactly as typed (a scale of 2 would turn `1.239` into `1.24`). Usage `value`
  and the insights totals are `numeric(14,2)`, because Node already rounds them to cents (`round2`). Prices go in and
  out through `Decimal(repr(float))` and back through the shortest float, so `2.5` stays `2.5`, as in
  `JSON.stringify`. Quantities stay `double precision`, as they are in JavaScript.
- **Text limits:** the API's limits are checked by the app (zod's code points, then Mongoose's UTF-16 units, with
  their messages, in `rules/`). The database adds a looser `CHECK (char_length(col) <= n)` as a last guard, which
  the app's checks always fail before, so its message never reaches a person.
- **JSONB only for small settings that are never searched:** `users.notification_preferences`, `users.alerts` and
  `users.meal_reminders`. The reminder sweep reads each person's settings in Python, because "is it 12:30 there
  now?" depends on their time zone and can't be an index lookup. If a later query has to filter on one of these
  settings, that setting becomes a column first.
  - **Two exceptions, both cached copies of generated output:** `recipe_idea_caches.recipes` (the AI's recipes) and
    `meal_reminder_logs.content` (what a reminder said). They are written and read whole, never searched, and kept
    for 3 and 7 days.
  - There are no dietary preferences in the app today. When they're added, they are another JSONB setting on
    `users`.
- **Foreign keys** use `ON DELETE CASCADE` where Node deletes the rows together (account deletion removes a
  person's food, favourites, subscriptions, logs and so on), and are named `<table>_<column>_fkey`.
  - **History keeps references to deleted rows on purpose.** On MongoDB, when someone deletes their account, the
    usage records other members made on that person's food keep the old `foodId`, and so do their reminders. Phase P
    first records what Node's API shows in each case:
    - another member's history;
    - another member's reminder feed;
    - a meal plan entry listing that food.
  - Where Node still shows the row, the column is a plain `uuid` with no foreign key. Where it doesn't, it is a
    foreign key with `CASCADE`. Each case gets a test, so the API answers the same.
- **One household per person** is a constraint, not a convention: `memberships.user_id` is the primary key.
- **The household size limit** (`HOUSEHOLD_MAX_MEMBERS`) and one-use invites are enforced in a transaction that
  locks the household row (`SELECT ... FOR UPDATE`). So two people joining at once can't both take the last place.

**Tables** (17). "FK" means a foreign key. Every column in a CHECK list takes its values from `shared/data`.

| Table | Columns (besides `id`, `created_at`, `updated_at`) | Keys, constraints and indexes |
|---|---|---|
| `households` | none | Made when a person registers or leaves a shared household, as Node makes a new `householdId`. |
| `users` | `name`, `email`, `password_hash`, `time_zone`, `currency` (CHECK), `save_photos`, `first_run_done`, `reminder_mode` (CHECK), `reminder_hour` (CHECK 0–23), `last_digest_date date`, `notification_preferences jsonb`, `alerts jsonb`, `meal_reminders jsonb` | **`UNIQUE (lower(email))`**, so `A@x.com` and `a@x.com` can't both register even if a lower-casing step were ever missed. The app still lower-cases and trims, as Mongoose does, so the stored value is unchanged. A unique-violation maps to the same 409 "email already registered". |
| `memberships` | `user_id` (PK, FK users CASCADE), `household_id` (FK households), `joined_at timestamptz` | Index `(household_id, joined_at, user_id)`, for the member list in Node's order. |
| `invites` | `household_id` (FK households CASCADE), `code`, `created_by` (FK users CASCADE), `expires_at` | `UNIQUE (code)`; index `(household_id)`; index `(expires_at)` for clean-up. A join claims the code with `DELETE ... WHERE code = $1 AND expires_at > $2 RETURNING`, as Node's `findOneAndDelete`. |
| `food_items` | `household_id` (FK), `user_id` (FK users CASCADE), `name`, `quantity double precision` (CHECK > 0), `unit` (CHECK), `added_date date`, `lifespan_days` (CHECK 0–365), `expiry_date date`, `expiry_source` (CHECK), `estimate_explanation`, `printed_date date`, `printed_date_type` (CHECK), `source_before_opened` (CHECK), `explanation_before_opened`, `notes`, `storage` (CHECK), `opened_date date`, `lifespan_before_opened`, `snoozed_until date`, `leftover boolean`, `price numeric`, `price_quantity`, `photo_at timestamptz`, `entered_lifespan_days`, `entered_storage` (CHECK), `entered_by_user`, `status` (CHECK), `closed_at timestamptz` | **Index `(household_id, status, expiry_date, id)`**: the inventory, the FridgeStock list, use-today and the reminder planning, all "this household's ACTIVE food by expiry". **Index `(household_id, expiry_date)`**: for reads by expiry that don't filter on status. It was asked for explicitly; the query-plan test below names the queries that use it, and Phase P reports it if none do. Index `(user_id, created_at DESC, id DESC) WHERE entered_by_user`: learned lifespans. Partial index `(closed_at) WHERE status <> 'ACTIVE'`: photo clean-up. |
| `usage_records` | `household_id` (FK), `user_id` (FK users CASCADE), `food_id` (see "History" above), `action` (CHECK), `date date`, `quantity_used`, `food_name`, `unit`, `quantity_remaining`, `value numeric(14,2)` | Index `(household_id, date DESC, created_at DESC, id DESC)`: history pages. Index `(household_id, food_id, created_at DESC, id DESC)`: undo's "latest record for this food". Index `(user_id, date DESC, created_at DESC)`: the export. |
| `notifications` | `user_id` (FK users CASCADE), `food_id`, `type` (CHECK), `expiry_date date`, `scheduled_date date`, `status` (CHECK), `attempts`, `last_error`, `message`, `sent_at`, `read_at`, `pushed_at` | `UNIQUE (user_id, food_id, type, expiry_date)`: one reminder of each kind per expiry, used by scheduling's `INSERT ... ON CONFLICT`. Index `(user_id, status, scheduled_date)`. Index `(user_id, scheduled_date DESC, sent_at DESC, id DESC)`: the feed. Partial index `(scheduled_date) WHERE status = 'PENDING'`: the sweep. Index `(food_id)`: cancelling a food's reminders. |
| `push_subscriptions` | `user_id` (FK users CASCADE), `platform` (CHECK), `endpoint`, `p256dh`, `auth`, `token`, `browser`, `last_used_at` | `UNIQUE (user_id, endpoint)`; index `(endpoint)`; index `(user_id, token)`. `CHECK ((platform = 'web') = (p256dh IS NOT NULL AND auth IS NOT NULL))` and `CHECK (platform = 'web' OR token IS NOT NULL)`, the rule Mongoose's `required` functions state. |
| `favourites` | `user_id` (FK users CASCADE), `name`, `name_key`, `quantity`, `unit` (CHECK), `lifespan_days`, `storage` (CHECK) | `UNIQUE (user_id, name_key)`; the list reads in `name_key` order, and the unique index serves it. |
| `shopping_items` | `household_id` (FK), `user_id` (FK users CASCADE), `name`, `quantity`, `unit` (CHECK, nullable), `checked` | Index `(household_id, checked, created_at, id)`: the list in Node's order. |
| `meal_plan_entries` | `household_id` (FK), `user_id` (FK users CASCADE), `date date`, `meal` (CHECK), `title` | `UNIQUE (household_id, date, meal)`, used by `PUT /meal-plan/:date` as an upsert. Index `(household_id, date)`: the week view. |
| `meal_plan_entry_foods` | `entry_id` (FK meal_plan_entries CASCADE), `position smallint`, `food_id` | **The link table for `foodIds`.** `PRIMARY KEY (entry_id, position)`, so the list keeps its order; `UNIQUE (entry_id, food_id)`; index `(food_id)`. `CHECK (position BETWEEN 0 AND 9)` (at most 10, as the schema says). |
| `household_events` | `household_id` (FK), `user_id` (FK users CASCADE), `actor_name`, `type` (CHECK: `MEMBER_JOINED`, `MEMBER_LEFT`, `PHOTO_CHECKED`), `food_name` | Index `(household_id, created_at DESC, id DESC)`: the activity log. |
| `photos` | `food_id` (FK food_items CASCADE), `household_id` (FK), `uploaded_by` (FK users CASCADE), `size` (CHECK `full`, `thumb`), `content_type`, `byte_size`, `data bytea` | `UNIQUE (food_id, size)`: a new photo replaces the old one in one statement. Index `(household_id)`; index `(uploaded_by)`. Reads check `household_id` as Node checks the GridFS metadata. Only `storage/postgres.py` touches this table. |
| `recipe_idea_caches` | `household_id` (FK), `user_id` (FK users CASCADE), `date date`, `meal_type` (CHECK), `recipes jsonb`, `expires_at` | `UNIQUE (household_id, date, meal_type)`; index `(expires_at)`. |
| `meal_reminder_logs` | `user_id` (FK users CASCADE), `household_id` (FK), `date date`, `meal` (CHECK), `sent_at`, `content jsonb`, `recipe_title`, `snoozed_until timestamptz`, `expires_at` | `UNIQUE (user_id, date, meal)`, which is what stops a meal reminder being sent twice. Partial index `(user_id) WHERE snoozed_until IS NOT NULL`; index `(expires_at)`. |
| `ai_usages` | `user_id` (FK users CASCADE), `date date`, `count` (CHECK ≥ 0) | `PRIMARY KEY (user_id, date)`, with no `id`. The daily limit is one statement: `INSERT ... ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1 WHERE ai_usages.count < $limit RETURNING count`. |
| `used_action_tokens` | `jti`, `expires_at` | `PRIMARY KEY (jti)`, so a second use is a unique-violation, as now; index `(expires_at)`. |

**MongoDB's TTL indexes** (`recipeideacaches` 3 days, `mealreminderlogs` 7 days, `usedactiontokens` at `expiresAt`)
become an `expires_at` column, two guards and a clean-up:
- Every read ignores expired rows (`expires_at > now`, from the app's clock), so the API never sees one, as with
  MongoDB.
- The 03:30 clean-up job deletes them, with expired invites.

**What the request listed that the app doesn't have yet:**
- **Leftover ingredients:** a leftover is a food item with `leftover = true` and no link to what it was made from.
- **Custom catalog foods:** the catalog is the fixed `shared/data/food-reference.json`, and people's own lifespans
  are learned from `food_items`.
- **Dietary preferences.**

Adding any of them now would change the API, so no table is made for them. When one is built, it follows the rules
above: leftover ingredients as a link table `food_item_ingredients (food_id, ingredient_id)`, custom catalog foods as
a `catalog_foods` table per household, and dietary preferences as a JSONB setting on `users`.

**Every query has an index, and a test proves it.** Each repository function is listed in
`tests/test_query_plans.py` with a typical argument. The test fills a database with a few thousand rows over several
households, runs `EXPLAIN (FORMAT JSON)` on each function's SQL, and fails on a sequential scan of any table but a
tiny one. It also fails if a repository function has no entry, so a new query can't arrive without its index.

### Logins and tokens
- **Login tokens:** HS256 with the same `JWT_SECRET`, `sub` = user id, and an expiry from `JWT_EXPIRES_IN`. The value is parsed in the same `ms` format as now (`7d`, `12h`), including `exp`/`iat`.
  - Tokens with an `aud` claim are refused as logins, as now.
  - Tokens issued by Node work on Python, and the other way round. A test checks both directions.
- **Notification action tokens:** the same audiences, `jti`, 24-hour life and single use through `used_action_tokens`.
- **Passwords:** `bcrypt` checks the existing `$2b$` hashes, and new hashes use the same cost factor.

### What can't be byte-for-byte identical
- **Photos:** Pillow and sharp produce different WebP bytes. The tests compare format, size limits, dimensions and the absence of EXIF/GPS instead.
- **Generated values:** ids, timestamps and tokens differ by nature. The contract tests normalise them (§7).
- **The format of IDs:** 24-hex on Node, UUID strings on Python (§4, "IDs"). The tests check each server's format,
  and that the same ID appears in the same places, rather than equal values.

## 5. Shared logic: one source, two languages

| Moves to `shared/data/` (JSON) | Read by |
|---|---|
| `food-reference.json`: the 43 catalog foods and `REFERENCE_SOURCE` | `shared/src/foodReference.ts` and `server_py/shared/reference.py` |
| `category-defaults.json`: `CATEGORY_DEFAULTS` | the same |
| `banned-phrases.json`: `BANNED_PHRASES` plus the "safe" word rule | `shared/src/wording.ts` and `server_py/shared/wording.py` |
| `estimate-copy.json`: the explanation texts in `estimateCopy.ts` | `shared/src/estimateCopy.ts` and its Python port |
| `messages.json` (**an addition to your list**): the server's response wording now in `server/src/copy.ts` (reminder text, error messages and so on). Responses must match exactly, so this avoids a second copy. | `server/src/copy.ts` (until removal) and `server_py/copy.py` |

The TypeScript modules keep exporting exactly what they export today, now loaded from JSON. The client imports the
same names, so client code doesn't change. Existing TypeScript tests prove nothing moved.

**Ported to Python** (`server_py/shared/`): the enums, the date helpers (`addDays`, `diffDays`, `todayInTz`,
`isValidDate`, `formatDisplay`), `alerts.ts`, `barcode.ts`, `estimateExpiry`, and the priority engine
(`server/src/services/priorityEngine.ts`, which is server-side today).

**Shared test cases** (`shared/test-cases/*.json`, `{name, input, expected}`):
- `dates.json`, `estimate.json`, `priority.json`, `barcode.json`, `wording.json`, `reference.json`, `alerts.json`.
- `validation.json` from §4.
- These start from the cases already in `shared/src/*.test.ts` and `priorityEngine.test.ts`, then grow with time-zone and DST edges.
- A Vitest file and a pytest file each loop over every case. CI fails if either language disagrees. A case added for one language is automatically a test for the other.

**API types from OpenAPI:**
- `shared/src/api.ts` stays the hand-written source the client imports, so the client doesn't change.
- `openapi-typescript` turns FastAPI's `/openapi.json` into `shared/src/openapi.generated.ts`.
- A type-level conformance file asserts that each response type in `api.ts` and its generated twin are assignable both ways. It runs in `npm run typecheck`, so if the Python models drift from the client's types, CI fails.
- Replacing `api.ts` with the generated types is possible later, but would touch client imports, so it is out of scope.

## 6. Phases

Each phase ends with ruff, pyright and its pytest group passing, a commit, and the CI run green. Each one ports the
matching tests from `server/src/tests` (listed with today's test counts) so behaviour is proven the same.

| Phase | Builds | Tests ported |
|---|---|---|
| **0. Shared data** | `shared/data/*.json`, the TS modules reading it, `shared/test-cases/`, the zod-to-JSON validation case generator, `server-py/` skeleton, the dev/test database helper (§8), and CI jobs (§9). | The existing TS suites must still pass unchanged. |
| **1. Foundation** | Config and settings (with the same start-up AI warnings), the database connection and start-up migrations, error handling with 422 → 400, body limits, security headers, CORS, the request log, auth (register, login, `/auth/me` GET/PUT), JWT and bcrypt, the auth rate limit, and `GET /health`. "Config routes" means the existing `GET /push/config` and `GET /ai/status`: there is no general config route, and adding one would change the API. | `api` 14, `auth` 13, `phase1` 16, `security` 9, the route-walk part of `structure` |
| **2. Foods** | Food CRUD and bulk, the priority engine, FridgeStock, use/waste/remove, use-today, open/undo-open, move, undo, usage history, favourites and learned lifespans. | `foods` 26, `priorityEngine` 12, `phase2` 17, `rules` 11 |
| **P. PostgreSQL** | See the list below the table. | Every Phase 1 and 2 test, now on PostgreSQL, plus the new database tests. `pytest -m phaseP`. |
| **3. Photos and barcodes** | Photo upload/serve/remove through `PhotoStore` (the `photos` table, bytea) with Pillow, `GET /products/barcode` through httpx, and the scan rate limit. | `photo` 23, `photos` 34, `scanning` (barcode part) |
| **4. Reminders and push** | Reminder planning, the sweep, digests, delivery and alert settings, meal reminders, the notification feed, web push and FCM payloads (same field names as `fcmProvider.ts`), push subscriptions, `/push/actions` with single-use tokens, and both scheduled jobs with the single-run guarantee below (row locking, no `joblocks`). | `notifications` 20, `phase3` 36, `meals` 61, `native` 23, `mealContent` 11, `phase4` 24 |
| **5. AI and parsing** | Provider routing (Claude and Gemini, fast/smart), the daily limit, output checks with banned wording, recipe ideas and meal plans, `/parse/receipt`, `/parse/photo`, `/parse/date`, the automatic expiry pipeline, and `ai_eval.py`. | `aiProviders` 25, `evaluation` 11, `expiryEstimate` 23, `scanning` (rest), `noAiJourney` 1, `foodSafetyCopy` 6, `phase5` 20 |
| **6. Everything else** | Household (invites, join, leave, activity, with the household row locked while people join), shopping, meal plan (with `meal_plan_entry_foods`), insights, account export and delete, `seed.py`, and the rest of the structure rules. | `household` 29, `phase6` 8, `firstRun` 5, `structure` 15 |
| **7. Contract and E2E** | §7 below. | All recorded contracts, plus the full Playwright suite against Python |
| **8. Switch** | Only with your approval (§10). | |

**Phase P, in order** (each step keeps the existing tests passing before the next starts):
1. **IDs:** `db/ids.py` (monotonic UUIDv7), the shared `idSchema` that accepts both formats, `validation.json`
   regenerated, and Node's small UUID-as-not-found change with its test (§4, "IDs"). The client suite is run once
   with UUID fixture IDs.
2. **Database:**
   - `db/engine.py` (pool, one session and transaction per request, `DATABASE_URL` normalised to
     `postgresql+asyncpg://`, TLS when the host asks for it);
   - `db/tables.py` with all 17 tables of §4;
   - the Alembic baseline `0001`;
   - `alembic upgrade head` before start-up, under an advisory lock.
   All the tables are made now, so later phases add repositories, not schema.
3. **Repositories and records** for what Phases 1–2 use: users, households and memberships, food items, usage
   records, favourites, and reminder scheduling and delivery. The `PhotoStore` interface is defined, and its
   PostgreSQL version is built in Phase 3.
4. **Phases 1–2 reworked onto them.** The services keep their names and signatures but call repositories. Then the
   MongoDB code goes:
   - the persistence half of `models/`, and `models/migrations.py`;
   - PyMongo and the GridFS code;
   - `tests/test_models.py`'s Mongoose recordings;
   - the Python side of `dev-mongo.mjs`.
   The validators move to `rules/`. Duplicate-key handling becomes `IntegrityError` mapping, by constraint name, to
   the same 409s.
5. **Tests on a real PostgreSQL, rolled back after each one** (§8).
   - New: `test_schema.py` (every table, constraint, CHECK list and index; Alembic's models-versus-migrations check
     is empty; upgrade then downgrade then upgrade works) and `test_query_plans.py` (§4).
   - `rules`' recording of database commands moves from PyMongo's command monitoring to SQLAlchemy's
     `before_cursor_execute` event.
6. **`compare:py` reworked** for PostgreSQL (§7), and the CI job given a PostgreSQL service (§9).
7. **Docs and config:** `render.yaml`, `server-py/.env.example`, the README, `server-py/README.md`,
   `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md` (with installing PostgreSQL on Windows and the
   online hosts, §8 and §9) and `CHANGELOG.md`.

**Jobs run once, even with several server copies.** This isn't guaranteed on Node: its sweep reads open reminders,
sends them, then saves the result, so two copies could each send the same one. On PostgreSQL, the rows themselves
are the lock, so `joblocks` and any job-wide lease are no longer needed:
- **Food reminders** are claimed per person, because "today" depends on each person's time zone (the Node sweep
  also works person by person). The claim takes row locks that other copies skip:
  ```sql
  SELECT id, ... FROM notifications
  WHERE user_id = $user AND status = 'PENDING' AND scheduled_date <= $today_in_their_zone
  ORDER BY scheduled_date, id
  LIMIT 100
  FOR UPDATE SKIP LOCKED
  ```
  The index `(user_id, status, scheduled_date)` serves this. `GET /foods`, which delivers due reminders first, uses
  the same claim, so a request and the sweep can't deliver the same reminder either.
  - Each batch is one transaction: claim, deliver (in-app, then push), mark `SENT` with `sent_at` and
    `pushed_at`, then commit.
  - A second copy running at the same time skips the locked rows and takes the next ones, so the same reminder is
    never handed to two copies.
  - When the first copy commits, the rows are no longer `PENDING`, so nobody picks them up later.
  - Batches stay small, so locks are held for seconds.
  - **What this can't promise:** if a copy crashes after a push has left but before its commit, that batch is
    claimed again and those pushes go out a second time. No database can make a send to an outside service and a
    commit one step. It needs a crash in that gap, and two healthy copies never cause it.
- **Daily digests** are claimed per person with one statement:
  ```sql
  UPDATE users SET last_digest_date = $today
  WHERE id = $id AND last_digest_date IS DISTINCT FROM $today
  RETURNING id
  ```
  Only the copy that gets the row back sends the digest.
- **Meal reminders** are claimed by inserting their log row: `INSERT ... ON CONFLICT (user_id, date, meal) DO NOTHING
  RETURNING id`, so only one copy sends each.
- **The 03:30 clean-up** (the photos of closed food, expired caches, logs, invites and used tokens) is made of
  deletes that are safe to run twice. Each run takes `pg_try_advisory_xact_lock` so two copies don't do the same work
  at once; if the lock is taken, the copy skips that run.
- **`JOBS_ENABLED` stays on the Python server** (from Phase 4), so a second copy can serve requests without running
  jobs. It no longer has a role in the switch, because the two servers never share a database. Node's setting from
  Phase 0 stays as it is, unused.
- A test starts two schedulers on one database with 500 due reminders and checks that each is delivered exactly
  once. It also checks that a copy that is killed mid-batch leaves its rows to the other copy.

## 7. Contract tests and end-to-end

**The rule, for every comparison: the same seeded data, compared by structure and value, never by exact ID.**
- **Same data:** each server starts on its own empty database: Node on its embedded MongoDB, Python on a fresh
  PostgreSQL database that the script creates and drops. Then the same seed and the same scripted requests go
  through the API, with a fixed clock and the AI, product and push stubs. Nothing is written to either database
  directly, so the data is identical by construction.
- **IDs are compared by role, not value.** Every ID is replaced by a placeholder numbered by first appearance
  (`<id:1>`, `<id:2>`, ...). Two responses match when:
  - each Node ID is a 24-hex ObjectId and each Python ID is a UUID;
  - the same placeholder sits in the same places. So "the food created in step 3 is the one undone in step 9" must
    hold on both servers, even though the strings differ.
  The same goes for IDs inside strings (`food:<id>` in activity, `/food/<id>` in push URLs) and inside tokens'
  claims.
- **Everything else must be equal:** status, chosen headers, key order and every value. Timestamps come from the
  fixed clock, so they compare as values. Tokens compare by their decoded claims, with IDs as placeholders.

**`npm run compare:py`** (already used since Phase 2) changes in Phase P:
- It drops the comparison of documents left in MongoDB.
- To compare the stored data instead, it ends the journey by reading it back through the API on both servers:
  - the account export (`GET /account/export`, which holds every row a person owns), once Phase 6 has it;
  - until then, the inventory, history, favourites and reminder feed.
- Each later phase adds its routes to the journey, as now.

**Recorded cassettes (Phase 7):**
1. A recorder runs the seeded scenario against the Node server. It calls **every one of the 68 routes**, both happy
   paths and the main failures (400, 401, 404, 409, 413, 415, 429).
2. Each call is saved as `server-py/tests/contract/cassettes/<group>.json`, holding the request, status, chosen
   headers and body, already normalised as above. So the files are deterministic, and the recorder fails if any
   route has no cassette.
3. pytest replays the scenario against the Python server and requires a match under the same rule. The cassettes
   are committed, and re-recording is a deliberate step when the API is meant to change.

**No cross-server data test.** The servers never share a database, so neither has to read what the other wrote
(§10).

**End-to-end:**
- `playwright.config.ts` gets `E2E_SERVER=py`, which starts Uvicorn instead of `tsx`, on a fresh PostgreSQL
  database (`fridgestock_e2e`, dropped and remade, then migrated) in place of `EPHEMERAL_DB=1`.
- The existing stubs (`e2e/stub-anthropic.mjs`, `e2e/stub-products.mjs`) are reused: the Python SDKs point at them through their base-URL settings.
- The full suite must pass on both mobile and desktop profiles.

## 8. Running it locally (and memory on this PC)

- **Database: PostgreSQL installed directly on Windows,** with no Docker. The Node server keeps its embedded MongoDB
  (`npm run dev:server`), and the two never touch each other.
  1. **Install PostgreSQL 17 or newer** with the official installer linked from
     [postgresql.org/download/windows](https://www.postgresql.org/download/windows/).
     - Components: PostgreSQL Server and Command Line Tools. pgAdmin is optional, and Stack Builder isn't needed.
     - Data directory `E:\PostgreSQL\data`, port 5432.
     - You choose the `postgres` superuser's password in the installer and keep it to yourself. No script or step
       ever asks for it, and it is never pasted into a chat, a file in the repository or a command line.
     - It installs a Windows service (`postgresql-x64-<version>`) that starts with the PC. To save memory, set it
       to *Manual* in `services.msc` and start it when you work on the server.
  2. **Create the app's login and databases with `psql`,** as the `postgres` user; `psql` itself asks for the
     password, so it isn't typed anywhere else. The commands create the role `fridgestock` and the databases
     `fridgestock` (development) and `fridgestock_test` (tests), with `<your-password>` as the placeholder you
     replace when you run them.
     - They are written out in `server-py/README.md`.
     - The role isn't a superuser. It owns its two databases, so Alembic and the tests can create and drop tables
       in them.
  3. **Put the connection in `server-py/.env`** (gitignored), replacing the placeholder yourself:
     ```
     DATABASE_URL=postgresql+asyncpg://fridgestock:<your-password>@localhost:5432/fridgestock
     TEST_DATABASE_URL=postgresql+asyncpg://fridgestock:<your-password>@localhost:5432/fridgestock_test
     ```
     A password with `@`, `:`, `/` or `%` must be percent-encoded in the URL (`@` is `%40`).
  4. **`npm run dev:server-py`** runs `alembic upgrade head` and then Uvicorn with `--reload`. The development
     database keeps its data across restarts, as `db:py` did.
  - `npm run db:py` and `db:py:empty` are removed, and so is the Python server's use of `dev-mongo.mjs`.
- **pytest database:** a real PostgreSQL, never a stand-in. `TEST_DATABASE_URL` points at it (the local
  `fridgestock_test`, or CI's service).
  - **Once per test session**, pytest drops and recreates every table and runs the Alembic migrations from empty, so
    each run also tests the migrations.
  - **pytest runs in small groups locally** (`-m phaseP`, `-m phase1`, `-m phase2`, ...), one at a time, to keep
    memory low; CI runs them all.
  - **Each test runs inside a transaction that is rolled back afterwards.** The test opens one connection, begins a
    transaction, and gives the app under test a session bound to that connection with
    `join_transaction_mode="create_savepoint"`. So the app's own commits and rollbacks become savepoints, and
    nothing a test writes outlives it. That keeps tests fast (no truncating or re-migrating between them) and
    independent, and the clock is reset for each.
  - **Tests that need real commits,** such as two schedulers on separate connections racing for the same rows with
    `SKIP LOCKED`, take a `committed_db` fixture instead, which truncates the tables afterwards. They are marked, and
    kept few.
- **Memory:**
  - pytest runs one phase group at a time locally (`-m phase2` and so on), without parallel workers.
  - Playwright, the contract suite and the full matrix run on GitHub Actions.
  - The dev servers can be stopped while tests run.

## 9. CI, deployment and docs

- **CI (`ci.yml`):**
  - Job "Python server (3.12 / 3.13)": `uv sync`, ruff check, ruff format check, pyright and pytest.
    - From Phase P it runs a `postgres` service container (images 17 and 18 in the matrix), with a health check
      and `TEST_DATABASE_URL`, in place of the MongoDB service.
    - The Node jobs keep their MongoDB.
    - `compare:py` runs in CI too, with both services.
  - A job runs the shared test cases in both languages.
  - The contract suite gets its own job.
  - Once Phase 7 starts, the E2E job runs twice, against Node and against Python.
  - Android and iOS workflows stay as they are.
- **render.yaml:**
  - A new `fridgestock-api-py` service: Python runtime with `rootDir: server-py`, `PYTHON_VERSION`, and `uv sync --frozen --no-dev` to build.
  - **Render supports uv directly** (checked 2026-10-23, [render.com/docs/uv-version](https://render.com/docs/uv-version)): it adds uv to a Python service automatically when the service's root folder has a `uv.lock`, so no `requirements.txt` is needed. New services get uv 0.12.24 by default and this PC has 0.13.5, so `UV_VERSION` is pinned to the version that wrote the lock file.
  - The server reads `../shared/data` at run time. The first deploy checks that a `rootDir` service still sees the rest of the repository; if it doesn't, the JSON files are copied into the package at build time. `buildFilter` includes `shared/data/**` so data changes redeploy.
  - Start command: `alembic upgrade head && python -m server_py` (uvicorn on `PORT`, every address, one worker, no proxy rewriting and no `Server` header). One worker fits the free plan's 512 MB, and row locking covers more copies. The migration runs in the start command, not `preDeployCommand`, because Render offers that only on paid plans; the advisory lock makes it safe when two copies start together.
  - A `databases:` entry, `fridgestock-db` (PostgreSQL 17 or newer), and `DATABASE_URL` taken from it with `fromDatabase: connectionString`. Render hands out `postgresql://...`, which `db/engine.py` turns into the asyncpg form.
  - The same environment variables as Node, except `MONGO_URI`, plus the same `JWT_SECRET`. It must be copied, not generated, so logins made on Node still work.
  - Deployment switches by swapping the Python service into the existing service name, so URLs don't change and the native apps keep working with no rebuild.
- **Online PostgreSQL hosts** (checked on 2026-10-27; `docs/DEPLOYMENT.md` will list them with how to connect each). Any host with PostgreSQL 17 or newer and TLS works, because the app needs only a connection string.
  - **Render Postgres:** the same dashboard and region as the API, and `render.yaml` can create it. The free plan expires 30 days after creation (then 14 days to upgrade before it's deleted), has 1 GB and no backups, so it suits a staging trial only. A paid plan is the simple choice for production. ([render.com/docs/free](https://render.com/docs/free))
  - **Neon:** serverless PostgreSQL that scales to zero when idle, with a free plan of about 0.5 GB per project and database branches (handy for a staging copy). Put the connection string in `DATABASE_URL`; use its pooled address with `statement_cache_size=0`, or the direct one.
  - **Supabase:** a free plan with about 500 MB, which pauses a project after a week without activity. It also offers auth and file storage, which FridgeStock doesn't need. The same pooler note applies.
  - **AWS RDS, Google Cloud SQL, Azure Database for PostgreSQL:** managed, paid, the usual choice at larger scale.
  - Figures for Neon and Supabase come from comparison articles and change often, so check each provider's pricing page before choosing. The recommendation is Render Postgres for staging (one place for everything), and either a paid Render plan or Neon for production. You decide that at deployment time.
- **Docs:** README (running and deploying, with PostgreSQL), `docs/ARCHITECTURE.md` (Python layers, repositories, the data model of §4, row locking), `docs/TESTING.md` (pytest groups, the PostgreSQL test database and rollback, shared cases, contracts), `docs/DEPLOYMENT.md` (installing PostgreSQL on Windows from §8, and the hosts above), `server-py/README.md`, `CHANGELOG.md`, and the `.env.example` files (`DATABASE_URL`, `TEST_DATABASE_URL`).

## 10. Switch, fallback and removal

1. **Approval gate:** before the switch, all of the following must be true, and you give the go-ahead:
   - every pytest group passes;
   - every contract matches;
   - the full Playwright suite passes against Python;
   - CI is green.
2. **Switch:** deploy the Python service under the production name, on its own PostgreSQL database
   (`fridgestock-db`), with the same `JWT_SECRET`. Then check `/api/health`, register and sign in, add food, and do
   one notification button tap on a phone.
   - **Nothing is carried over from MongoDB,** because nothing is live. If something has gone live on Node by the
     time of the switch, the switch stops here, and a one-off export-and-import script (MongoDB to the §4 tables,
     ObjectIds kept as a lookup to new UUIDs) becomes its own approved step first.
3. **No shared-database fallback.** The Node server stays on MongoDB until the switch, and it is never pointed at
   PostgreSQL. **Rolling back means redeploying the previous version,** in Render's dashboard or by reverting the
   commit:
   - **Straight after the switch,** the previous version is the Node service on MongoDB. Anything written on Python
     in between stays in PostgreSQL and isn't visible on Node. That is acceptable only because nothing is live,
     and it is why the switch is checked with test accounts.
   - **After that, the previous version is the previous Python release,** on the same database. So **every Alembic
     migration is backward-compatible with the release before it** ("expand, then contract"):
     - add a column or table in one release, start using it in the next;
     - drop the old one a release later;
     - never rename or tighten in one step.
     A test reads each Alembic revision's operations and fails on one that drops, renames or tightens (adds
     `NOT NULL` or a CHECK on existing data) unless the revision is marked as a contract step. Downgrades are written
     and tested, but production rolls forward or redeploys; it never runs a downgrade.
   - Render keeps the previous deploys, and its paid PostgreSQL plans keep backups. Before each migration that drops
     anything, the deploy guide says to take a manual backup.
   - **`JOBS_ENABLED`** has no part in the switch any more. Node and Python never run against the same data, so
     each server simply runs its own jobs. Python's setting stays for running a request-only copy.
4. **Removal (the release after the switch):**
   - Delete `server/`, its CI steps, the Node service in `render.yaml`, the `server` workspace, and the
     MongoDB-only parts: `mongodb-memory-server`, `dev-mongo.mjs`, `docker-compose.yml`'s MongoDB and the `MONGO_URI`
     settings.
   - Move the two client tests that read server files (`client/src/test/native-config.test.ts` and `native-sounds.test.ts`, which compare FCM field names with `server/src/services/fcmProvider.ts`) over to `server-py/server_py/services/fcm_provider.py`. These are test files only. No client app, Android or iOS code changes.
   - The shared TypeScript package stays, because the client uses it.

## 11. Decisions (approved 2026-10-23)

1. **Server wording in JSON:** move `server/src/copy.ts` to `shared/data/messages.json` as well. **Approved.**
2. **Dev database:** reuse `mongodb-memory-server` through the small Node script, persistent by default with a separate empty mode for tests. **Approved.**
3. **OpenAPI types:** keep `shared/src/api.ts` as the client's types, with a CI drift check against the FastAPI types. **Approved.**
4. **Job single-run:** add the `joblocks` collection and per-reminder claiming, plus `JOBS_ENABLED` on both servers. **Approved.** *Replaced by decision 11.*
5. **Environment manager:** uv, deployed with Render's built-in uv support. **Approved.**

Decision 2 (the dev database) is replaced by decision 12 for the Python server; Node keeps its embedded MongoDB.

### Revision of 2026-10-27: PostgreSQL (decided by you; the details below wait for approval)

6. **Database:** PostgreSQL for the Python server, through SQLAlchemy 2.0 async, asyncpg and Alembic. Nothing is
   migrated from MongoDB. *Your decision.*
7. **Repository layer:** only `repositories/` and `storage/` touch the database. There is one transaction per
   request, and repositories return plain dataclasses (§3). Phases 1–2 are reworked onto it in Phase P. *Your
   decision; the transaction-per-request detail is the recommendation.*
8. **IDs:** UUID primary keys as strings in the API. **Recommended: UUIDv7, generated by the app,** so lists that
   break ties by ID keep Node's order. The shared schemas accept either format, with a small, tested Node change
   (§4, "IDs").
9. **Data model:** the 17 tables of §4, with:
   - text plus CHECK for status values, `date` for calendar dates and `numeric` for money;
   - JSONB only for settings, plus the two caches of generated output;
   - a unique index on `lower(email)`;
   - a link table for meal plan foods.
   **Recommended:** history columns that Node leaves pointing at deleted rows stay plain UUIDs, decided case by case
   from what Node's API shows. No tables for leftover ingredients, custom catalog foods or dietary preferences,
   because those features don't exist and adding them would change the API.
10. **Photos:** the `photos` table (bytea) behind `PhotoStore`, so object storage can replace it later. *Your
    decision.*
11. **Jobs run once through row locking:** `FOR UPDATE SKIP LOCKED` for reminders, an atomic `UPDATE ... RETURNING`
    for digests, `ON CONFLICT` for meal reminders, and an advisory lock for the clean-up. No `joblocks` and no lease.
    The one remaining gap, a crash between a push and its commit, is stated in §6. *Your decision; the digest,
    meal and clean-up details are the recommendation.*
12. **Local and test databases:** PostgreSQL installed directly on Windows (§8). Tests run on a real PostgreSQL,
    each rolled back afterwards, and CI uses a PostgreSQL service on versions 17 and 18. *Your decision; the
    versions are the recommendation.*
13. **Contracts:** compared by structure and value on identical seeded data, with IDs matched by role (§7). The
    cross-server data test is removed. *Your decision.*
14. **Fallback:** no shared database; roll back by redeploying the previous version, with backward-compatible
    migrations (§10). *Your decision; the expand-then-contract rule is the recommendation.*

## 12. Risks

| Risk | How it's handled |
|---|---|
| Validation messages differ from zod's | The generated `validation.json` cases, plus custom validators where needed. |
| Order changes where Node breaks ties by `_id` | Monotonic UUIDv7, a test that 10,000 IDs sort in creation order, and `compare:py` comparing every list's order. |
| A response field changes type: `numeric` as a string or a `5.0`, a `date` as a datetime, `timestamptz` without milliseconds | Repositories convert at the edge into `records.py` types, and `compare:py` and the cassettes compare every value, including key order. |
| A query with no index gets slow as data grows | `test_query_plans.py` runs `EXPLAIN` on every repository function and fails on sequential scans (§4). |
| Behaviour that hangs on deleted rows (history, reminders and meal plans that point at food that's gone) | Recorded on Node first, then foreign keys or plain UUIDs chosen to match, each with a test (§4). |
| Connection limits and poolers on hosted PostgreSQL (asyncpg's prepared statements break behind PgBouncer's transaction mode) | Prefer the host's direct address; behind a pooler, set `statement_cache_size=0`. The pool size is a setting, and it's documented per host (§9). |
| A migration that breaks rolling back to the previous release | Expand then contract, with the test on Alembic operations (§10). |
| Tests pass inside a rolled-back transaction but fail under real commits (locks, deferred constraints) | The `committed_db` tests for anything about concurrency or locking, and the E2E suite on a real committed database (§8). |
| Time-zone and DST edges differ between `Intl` and `zoneinfo` | Shared date cases that include DST changes and far-off time zones. |
| Rate-limit window and header details | Contract cassettes include the `RateLimit` headers and the 429 bodies. |
| Blocking push and Firebase SDKs stall the event loop | Run them in a thread pool, with a test that a slow push doesn't block other requests. |
| Two Python copies running jobs at once | Row locking with `SKIP LOCKED`, atomic claims and an advisory lock (§6), with the two-scheduler test. |
| Size: about 560 tests to port | Phased commits, each green in CI before the next starts. |
