# Python server migration plan

Status: **approved on 2026-10-23**, with the five recommended answers in §11 and two additions: `JOBS_ENABLED`
(§6, §10) and a persistent local database with a separate empty one for tests (§8).

## Progress

| Phase | State |
|---|---|
| 0. Shared data | **Done** (see the notes below). |
| 1. Foundation | **Done** (see the notes below). |
| 2. Foods | **Done** (see the notes below). |
| 3–8 | Not started. |

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

Goal: replace the TypeScript API in `server/` with a Python one in `server-py/`. To every client, the change must be
invisible. The web app, the Android app and the iOS app stay in TypeScript, Java and Swift, and their code doesn't
change. Existing databases and existing logins keep working without any data migration.

Work happens on the `python-backend` branch. `server/` stays untouched until the switch.

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
| Settings | `PORT`, `MONGO_URI`, `TEST_MONGO_URI`, `EPHEMERAL_DB`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, `AUTH_RATE_LIMIT`, `VAPID_*`, `FIREBASE_*`, `APNS_BUNDLE_ID`, `PUBLIC_API_URL`, `PRODUCT_LOOKUP_URL`, `PHOTO_CHECK`, `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART`, `GEMINI_TIER`. |

## 2. Stack

| Need | Python choice |
|---|---|
| Language | Python 3.12+ (CI runs 3.12 and 3.13, as Node runs 20.19 and 24 today). |
| Web | FastAPI on Uvicorn. |
| Validation | Pydantic v2. |
| Database | PyMongo's async client (`AsyncMongoClient`) with its async GridFS (`AsyncGridFSBucket`). There is no ODM; a small model layer in `server_py/models/` plays Mongoose's part (see §4). |
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
    db.py                 connection, dev/test database, migrations.py
    models/               one module per collection: indexes, defaults, timestamps
    schemas/              Pydantic models mirroring shared/src/schemas.ts
    services/             one module per TypeScript service, same names
    routes/               one APIRouter per group, same order as routes/index.ts
    middleware/           errors, auth, rate limits, request log, body limits
    jobs/                 reminder sweep, photo clean-up, job lock
    shared/               Python port of shared/src: enums, dates, estimate, priority, wording, reference
    messages.py           loads shared/data/messages.json (server/src/copy.ts)
  scripts/                seed.py, ai_eval.py, vapid_keys.py
  tests/                  pytest, one file per server/src/tests file, plus contract/
shared/data/              JSON read by both languages
shared/test-cases/        JSON cases both test suites must pass
```

The layer rules stay the same: routes → middleware → controllers/route handlers → services → models, only models touch
MongoDB, and nothing calls `datetime.now()` except `services/clock.py`. The structure tests for these rules are
ported to pytest.

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
  - AI: 20 per person per day, stored in `aiusages`, with reserve and refund.
  - **Response headers:** the IETF draft-8 `RateLimit` and `RateLimit-Policy` headers, with the same partition key.
- **Request log:** method, route, status and time only, never bodies or headers, as now.

### Data (Mongoose compatibility)
The Python server writes documents that Mongoose reads without any change, and reads what Mongoose wrote:
- **Collection names:** the same as Mongoose's pluralised names (listed in §1).
- **`_id` and `__v`:** `_id` is an ObjectId, and new documents get `__v: 0`, as Mongoose writes.
- **Timestamps:** `createdAt` and `updatedAt` are BSON UTC dates, set on insert. `updatedAt` is also bumped on every update, including `update_one`/`update_many`, as Mongoose's timestamps plugin does. `usagerecords` takes its times from the clock, as now.
- **Defaults on read:** Mongoose fills schema defaults for fields that are missing in older documents. Python must apply the same defaults when it reads, so each model module states its defaults once.
- **Dates:** food dates stay `"YYYY-MM-DD"` strings.
- **Indexes:** the same definitions, including the unique ones (`notifications` reminder key, `mealreminderlogs` day key, `usedactiontokens.jti`) and the TTL ones. They get Mongoose's default index names, so the start-up check never fights the Node server during the fallback period.
- **Start-up migrations:** `migrations.ts` is ported step by step. All steps are idempotent already. `syncIndexes()` becomes "create the indexes the model defines and drop the others", on the same 9 collections.
- **GridFS:** the same bucket name (`foodPhotos`), file names (`<foodId>-full`/`-thumb`) and metadata (`householdId`, `foodId`, `uploadedBy`, `size`).

### Logins and tokens
- **Login tokens:** HS256 with the same `JWT_SECRET`, `sub` = user id, and an expiry from `JWT_EXPIRES_IN`. The value is parsed in the same `ms` format as now (`7d`, `12h`), including `exp`/`iat`.
  - Tokens with an `aud` claim are refused as logins, as now.
  - Tokens issued by Node work on Python, and the other way round. A test checks both directions.
- **Notification action tokens:** the same audiences, `jti`, 24-hour life and single use through `usedactiontokens`.
- **Passwords:** `bcrypt` checks the existing `$2b$` hashes, and new hashes use the same cost factor.

### What can't be byte-for-byte identical
- **Photos:** Pillow and sharp produce different WebP bytes. The tests compare format, size limits, dimensions and the absence of EXIF/GPS instead.
- **Generated values:** ids, timestamps and tokens differ by nature. The contract tests normalise them (§7).

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
| **2. Foods** | Food CRUD and bulk, the priority engine, Cook First, use/waste/remove, use-today, open/undo-open, move, undo, usage history, favourites and learned lifespans. | `foods` 26, `priorityEngine` 12, `phase2` 17, `rules` 11 |
| **3. Photos and barcodes** | Photo upload/serve/remove on GridFS with Pillow, `GET /products/barcode` through httpx, and the scan rate limit. | `photo` 23, `photos` 34, `scanning` (barcode part) |
| **4. Reminders and push** | Reminder planning, the sweep, digests, delivery and alert settings, meal reminders, the notification feed, web push and FCM payloads (same field names as `fcmProvider.ts`), push subscriptions, `/push/actions` with single-use tokens, and both scheduled jobs with the single-run guarantee below. | `notifications` 20, `phase3` 36, `meals` 61, `native` 23, `mealContent` 11, `phase4` 24 |
| **5. AI and parsing** | Provider routing (Claude and Gemini, fast/smart), the daily limit, output checks with banned wording, recipe ideas and meal plans, `/parse/receipt`, `/parse/photo`, `/parse/date`, the automatic expiry pipeline, and `ai_eval.py`. | `aiProviders` 25, `evaluation` 11, `expiryEstimate` 23, `scanning` (rest), `noAiJourney` 1, `foodSafetyCopy` 6, `phase5` 20 |
| **6. Everything else** | Household (invites, join, leave, activity), shopping, meal plan, insights, account export and delete, `seed.py`, and the rest of the structure rules. | `household` 29, `phase6` 8, `firstRun` 5, `structure` 15 |
| **7. Contract and E2E** | §7 below. | All recorded contracts, plus the full Playwright suite against Python |
| **8. Switch** | Only with your approval (§10). | |

**Jobs run once, even with several server copies.** This isn't guaranteed today:
- The Node sweep reads open reminders, sends them, then saves the result. So two copies running together could each send the same reminder. Meal reminders are protected by their unique index; food reminders and the photo clean-up are not.
- The Python server adds two guards:
  1. A lease lock: one document per job in a new collection `joblocks`, taken with an atomic `find_one_and_update` and an expiry, so a crashed copy can't hold it forever.
  2. Each reminder is claimed atomically before it is sent, so even overlapping sweeps can't send it twice.
- `joblocks` is the one new collection. The Node server ignores it.
- **`JOBS_ENABLED`, on both servers.** Because Node ignores `joblocks`, the lock alone can't stop Node and Python both running jobs. Both servers therefore get a `JOBS_ENABLED` setting:
  - `true` (the default, so nothing changes for today's single Node server): the server runs the reminder sweep and photo clean-up on schedule and once at start-up.
  - `false`: the server never starts the scheduler. It still serves every route.
  - Exactly one deployed server has it on at any time. §10 says which one at each stage.
  - The Node change is small (`server/src/config/env.ts` and `server/src/index.ts`, with a test) and is made in Phase 0. It is the one change to `server/` before the switch, and it is there so the fallback is safe.
  - The Python server reads it from Phase 4, when its jobs exist.
- A test runs two schedulers against one database and checks that each reminder is delivered once.

## 7. Contract tests and end-to-end

**Recording, against today's server:**
1. A recorder starts the Node server on a throwaway database with a fixed clock and the AI, product and push stubs.
2. It runs a scripted scenario that calls **every one of the 68 routes**, both happy paths and the main failures (400, 401, 404, 409, 413, 415, 429).
3. Each call is saved as `server-py/tests/contract/cassettes/<group>.json`, holding the request, status, chosen headers and body.
4. Ids, timestamps and tokens are replaced by stable placeholders, so the files are deterministic, and the recorder fails if any route has no cassette.

**Replaying:** pytest runs the same scenario against the Python server and requires an exact match after the same
normalisation. The cassettes are committed. Re-recording is a deliberate step when the API is meant to change.

**Cross-server data test:**
- Data written by Python must be read correctly by Node, and data written by Node by Python, through the API on both sides. That covers users, food, photos and tokens.
- This is what makes the fallback in §10 safe.

**End-to-end:**
- `playwright.config.ts` gets `E2E_SERVER=py`, which starts Uvicorn instead of `tsx`.
- The existing stubs (`e2e/stub-anthropic.mjs`, `e2e/stub-products.mjs`) are reused: the Python SDKs point at them through their base-URL settings.
- The full suite must pass on both mobile and desktop profiles.

## 8. Running it locally (and memory on this PC)

- **Database:** the TypeScript server's embedded MongoDB depends on Node's `mongodb-memory-server`, and there is no maintained Python equivalent. A small script, `server-py/scripts/dev-mongo.mjs`, reuses `mongodb-memory-server` (already installed) to start the same `mongod` binary. It has two modes:
  - **`npm run db:py`: keeps its data.** Data lives in `server-py/.data/`, which is gitignored (the existing `.data/` rule). Stopping and restarting it, or restarting the PC, keeps every account and item. It listens on port 27028, so it can run next to the Node server's database on 27027.
  - **`npm run db:py:empty`: starts empty, for tests.** A throwaway database in a new `server-py/.test-db-*` folder (gitignored by `.test-db-*/`), on a free port, deleted on exit. It prints its address for pytest or Playwright, and never touches `server-py/.data/`.
  - `npm run dev:server-py` starts the persistent database plus Uvicorn with `--reload`.
  - Node is needed anyway for the client, and this keeps "no Docker, no `mongod` install" true. Setting `MONGO_URI` skips the script, as now.
- **pytest database:** pytest starts the empty mode once per test session (like `globalSetup.ts`), or uses `TEST_MONGO_URI` when set, as CI does. Each test gets its own database name and a reset clock.
- **Memory:**
  - pytest runs one phase group at a time locally (`-m phase2` and so on), without parallel workers.
  - Playwright, the contract suite and the full matrix run on GitHub Actions.
  - The dev servers can be stopped while tests run.

## 9. CI, deployment and docs

- **CI (`ci.yml`):**
  - New job "Python server (3.12 / 3.13)": `uv sync`, ruff check, ruff format check, pyright and pytest. It uses a MongoDB service container, which is faster than downloading `mongod` each run.
  - A job runs the shared test cases in both languages.
  - The contract suite gets its own job.
  - Once Phase 7 starts, the E2E job runs twice, against Node and against Python.
  - Android and iOS workflows stay as they are.
- **render.yaml:**
  - A new `cook-first-api-py` service: Python runtime with `rootDir: server-py`, `PYTHON_VERSION`, and `uv sync --frozen --no-dev` to build.
  - **Render supports uv directly** (checked 2026-10-23, [render.com/docs/uv-version](https://render.com/docs/uv-version)): it adds uv to a Python service automatically when the service's root folder has a `uv.lock`, so no `requirements.txt` is needed. New services get uv 0.12.24 by default and this PC has 0.13.5, so `UV_VERSION` is pinned to the version that wrote the lock file.
  - The server reads `../shared/data` at run time. The first deploy checks that a `rootDir` service still sees the rest of the repository; if it doesn't, the JSON files are copied into the package at build time. `buildFilter` includes `shared/data/**` so data changes redeploy.
  - Start command: `python -m server_py` (uvicorn on `PORT`, every address, one worker, no proxy rewriting and no `Server` header). One worker fits the free plan's 512 MB, and the job lock covers more.
  - The same environment variables, plus the same `JWT_SECRET`, which must be copied, not generated.
  - Deployment switches by pointing `PUBLIC_API_URL` and the client's `VITE_API_URL` at the service, or by swapping it into the existing service name so URLs don't change. The swap is preferred, because the native apps keep working with no rebuild.
- **Docs:** README (running and deploying), `docs/ARCHITECTURE.md` (Python layers, `joblocks`), `docs/TESTING.md` (pytest groups, shared cases, contracts), `docs/DEPLOYMENT.md`, `server-py/README.md`, `CHANGELOG.md`, and `.env.example` files.

## 10. Switch, fallback and removal

1. **Approval gate:** before the switch, all of the following must be true, and you give the go-ahead:
   - every pytest group passes;
   - every contract matches;
   - the cross-server data test passes;
   - the full Playwright suite passes against Python;
   - CI is green.
2. **Switch:** deploy the Python service under the production name with the same `JWT_SECRET` and `MONGO_URI`. Then check `/api/health`, sign in with an existing account, and do one notification button tap on a phone.
3. **Fallback:** for one release, `server/` and its CI stay, and a Node service stays defined in `render.yaml` (suspended).
   - Rolling back means switching the service back. The data needs no change, because both servers write the same documents.
   - The only addition, `joblocks`, is ignored by Node.

**Which server runs the scheduled jobs (`JOBS_ENABLED`) at each stage:**

| Stage | Node server | Python server |
|---|---|---|
| Today, and while Python is built (Phases 0–7) | **on** (live) | not deployed; local and CI only |
| Python deployed alongside for checks, before the switch | **on** (live) | **off** (serves requests, runs no jobs) |
| Switch | set to **off** first, and confirm in its log that the scheduler didn't start | then set to **on** |
| Fallback release (Node suspended, kept for rollback) | **off** | **on** |
| Rollback, if needed | set to **on** after Python is turned **off** | **off** |
| Removal | gone | **on** (the default) |

Turning one off before turning the other on can skip at most one 5-minute sweep. That is harmless: the next sweep
sends everything that is due. Between two Python copies, `joblocks` and per-reminder claiming stop double sends.
4. **Removal (the next release):**
   - Delete `server/`, its CI steps, the Node service in `render.yaml` and the `server` workspace.
   - Move the two client tests that read server files (`client/src/test/native-config.test.ts` and `native-sounds.test.ts`, which compare FCM field names with `server/src/services/fcmProvider.ts`) over to `server-py/server_py/services/fcm_provider.py`. These are test files only. No client app, Android or iOS code changes.
   - The shared TypeScript package stays, because the client uses it.

## 11. Decisions (approved 2026-10-23)

1. **Server wording in JSON:** move `server/src/copy.ts` to `shared/data/messages.json` as well. **Approved.**
2. **Dev database:** reuse `mongodb-memory-server` through the small Node script, persistent by default with a separate empty mode for tests. **Approved.**
3. **OpenAPI types:** keep `shared/src/api.ts` as the client's types, with a CI drift check against the FastAPI types. **Approved.**
4. **Job single-run:** add the `joblocks` collection and per-reminder claiming, plus `JOBS_ENABLED` on both servers. **Approved.**
5. **Environment manager:** uv, deployed with Render's built-in uv support. **Approved.**

## 12. Risks

| Risk | How it's handled |
|---|---|
| Validation messages differ from zod's | The generated `validation.json` cases, plus custom validators where needed. |
| Mongoose behaviour that only shows on old data (defaults on read, `updatedAt` bumps) | Model-layer tests on documents written by Node, and the cross-server data test. |
| Time-zone and DST edges differ between `Intl` and `zoneinfo` | Shared date cases that include DST changes and far-off time zones. |
| Rate-limit window and header details | Contract cassettes include the `RateLimit` headers and the 429 bodies. |
| Blocking push and Firebase SDKs stall the event loop | Run them in a thread pool, with a test that a slow push doesn't block other requests. |
| Two servers running against one database during the fallback | Only one has `JOBS_ENABLED` on at each stage (§10). Between Python copies, the job lock and claim stop double sends. |
| Size: about 560 tests to port | Phased commits, each green in CI before the next starts. |
