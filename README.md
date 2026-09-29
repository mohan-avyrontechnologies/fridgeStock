# Cook First: Perishable Food Cooking Prioritiser

A mobile-first web app that helps a household use perishable food before it goes to waste. You log each item with a lifespan in days. The app works out its **expected expiry**, sorts everything so the most urgent food comes first, and shows a daily **Cook First** list.

> **Food-safety boundary:** *Expected expiry is an estimate to help you plan. Always check your food before eating it.* The app never claims that food is fit to eat.

| | |
|---|---|
| **Status** | MVP complete; post-MVP Phase 1 (faster entry) complete. Not yet deployed. |
| **Version** | 2.5.0 (see the [Changelog](#changelog)) |
| **Requires** | Node.js 20.19 or later |
| **Specifications** | PFCP BRD v2.0, FRD v1.0, SRD v1.0, TDD v1.0 (internal documents, not stored in this repo) |
| **Repository** | `github.com/rugvailabs/cook_first` |

---

## Contents

1. [Screenshots](#screenshots)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Architecture](#architecture)
5. [Project structure](#project-structure)
6. [Getting started](#getting-started)
7. [Configuration](#configuration)
8. [Scripts](#scripts)
9. [Testing](#testing)
10. [How it works](#how-it-works)
11. [Screens](#screens)
12. [Dates and time zones](#dates-and-time-zones)
13. [Data model](#data-model)
14. [API reference](#api-reference)
15. [Project rules](#project-rules)
16. [Security](#security)
17. [Deployment](#deployment)
18. [Differences from the design documents](#differences-from-the-design-documents)
19. [Build phases](#build-phases)
20. [Project status](#project-status)
21. [Changelog](#changelog)
22. [Roadmap](#roadmap)
23. [Keeping this README up to date](#keeping-this-readme-up-to-date)

---

## Screenshots

These screenshots are captured automatically by the Playwright test suite.

**Phone (Pixel 7)**

| Dashboard | Cook First | Recording what happened | Add food | Bulk add |
|---|---|---|---|---|
| ![Dashboard on a phone](docs/screenshots/mobile-02-dashboard.png) | ![Cook First on a phone](docs/screenshots/mobile-03-cook-first.png) | ![Action sheet on a phone](docs/screenshots/mobile-04-action-sheet.png) | ![Add food on a phone](docs/screenshots/mobile-07-add-food.png) | ![Bulk add on a phone](docs/screenshots/mobile-11-bulk-add.png) |

**Desktop (1440 × 900)**

| Dashboard | Sign in |
|---|---|
| ![Dashboard on desktop](docs/screenshots/desktop-02-dashboard.png) | ![Sign in on desktop](docs/screenshots/desktop-10-login.png) |

---

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register and log in with email and password. JWT sessions last 7 days; passwords are hashed with bcrypt. Your time zone is captured silently from the browser at sign-up. |
| **Add food** | **Favourites** to re-add with one tap, then one short form, with suggestions from the reference list as you type and a **Kept in** dropdown: name (focused automatically), quantity (defaults to 1), a unit dropdown (defaults to pcs), added date (defaults to today, never in the future), lifespan with 1/2/3/5/7/14-day quick picks plus a number box, and optional notes behind an "Add note" link. A live preview reads, for example, "Expected expiry: Thu, 1 Oct (2 days left)", with the disclaimer beneath it. Saving returns to the dashboard with a short confirmation. |
| **Expected expiry** | Added date + lifespan, calculated by the server's food service and never accepted from the client. It is recalculated whenever the added date or lifespan changes. A lifespan of 0 means the expected expiry is the day the item was added. |
| **Urgency** | 🟢 Not urgent (more than 3 days left) · 🟡 Use soon (1–3) · 🟠 Expected expiry today (0) · 🔴 Past expected expiry (below 0). Always shown as a colour **and** a text label. Each card also says "5 days left", "1 day left", "1 day past expected expiry" and so on. |
| **Priority order** | Sorted by expected expiry, then added date, then item ID, so the same data always gives the same order. |
| **Cook First** | Every active item that isn't "Not urgent", most urgent first. |
| **Dashboard** | A header with your name, a bell with the unread count and a settings icon. Then a summary bar (past, today, use soon, not urgent); a Cook First section with the top 3 urgent items and a "See all" link ("Nothing urgent right now." when empty); and the full list in priority order ("Your fridge is empty. Add your first item." when empty). A fixed **Add food** button is always in reach. |
| **Recording what happened** | On the details screen: **Used all · Used some · Wasted · Remove**. Each card has **Used** (all or some) and **Wasted** buttons. Actions happen at once and the message offers **Undo** for a few seconds (the server allows undo for 10 minutes). "Used some" asks for a quantity. Each action is saved as a usage record. |
| **History** | Every usage record, newest first, showing the food, action, quantity and date, with totals for each action and a "Load more" button. |
| **Reminders** | In-app only. Sent 3 days before expiry, on the expiry day, and the day after. Each type can be turned off in Settings. They're delivered whenever you open the dashboard or the Reminders screen, and by an hourly job. They count as read once you open the Reminders screen. |
| **Faster entry** | A **reference list of 43 common foods** with suggested lifespans for fridge, freezer and pantry. It suggests as you type, fills in the unit and lifespan, and the user can always change the number. **Favourites** save a food and re-add it with one tap. **Bulk add** handles a whole shopping haul (up to 50 items) in one go. |
| **Where it's kept** | Every item is kept in the **Fridge**, **Freezer** or **Pantry**, and can record an **opened date**. |
| **Settings** | Your name and email (read-only), switches for the three reminder types, a link to History, and Log out. |
| **Privacy** | Each user only ever sees their own food, history and reminders. |
| **Responsive** | Mobile-first and tested at **375 px** wide, with every button, link and field at least 44 px tall. From 1024 px wide: a sidebar and a two-column layout. Every screen has loading, empty and error states, and any 401 signs you out and returns you to the login page. |

---

## Tech stack

The project is a **TypeScript monorepo** using npm workspaces, with three packages: `client`, `server` and `shared`. It requires **Node.js 20.19 or later** (20.19 is the minimum that Vite and Mongoose support).

| Layer | Technology | Version |
|---|---|---|
| **Frontend** (`client`) | React | 19.3 |
| | Vite (build and dev server) | 8.3 |
| | React Router | 7.18 |
| | Tailwind CSS | 4.3 |
| | Zustand (app state; the login token is saved in `localStorage` through its `persist` middleware) | 5.0 |
| **Backend** (`server`) | Express | 5.2 |
| | Mongoose (MongoDB) | 9.10 |
| | jsonwebtoken (HS256) | 9.0 |
| | bcrypt | 6.0 |
| | zod (validation) | 4.6 |
| | node-cron (scheduled jobs) | 4.6 |
| | helmet, cors, express-rate-limit | 8.3 / 2.8 / 8.7 |
| **Shared** (`shared`) | Enums, API request and response types, zod schemas, date utilities | |
| **Language** | TypeScript | 6.0 |
| **Database** | MongoDB (docker-compose locally; MongoDB Atlas in production) | 8 |
| **Testing** | Vitest (unit) | 4.1 |
| | Supertest + mongodb-memory-server (API) | 7.3 / 11.3 |
| | Playwright (end-to-end) | 1.63 |
| | MSW (fake API in frontend tests), React Testing Library, jsdom | 2.15 / 16.3 / 27.4 |
| **Code quality** | ESLint with typescript-eslint and react-hooks; Prettier | 9 / 3 |
| **CI / hosting** | GitHub Actions · Vercel (client) · any Node host, e.g. Render (server) · MongoDB Atlas | |

> **Why TypeScript 6.0, not 7?** TypeScript 7 is the new native compiler and has no JavaScript API yet, so ESLint's TypeScript support can't run on it. 6.0 is the latest version that works with ESLint.

---

## Architecture

```
client (React)  ──HTTP/JSON──▶  server (Express)  ──Mongoose──▶  MongoDB
      │                               │
      └──────── @cook-first/shared ───┘   enums · API types · zod schemas · dates.ts
```

**How a request flows through the server:**

```
routes → middleware (rate limit → JWT auth → zod validation) → controller → service → model → MongoDB
```

- **Routes** (`routes/index.ts`) only connect each path to its middleware and controller.
- **Middleware** checks the JWT and attaches the user, validates the request with a shared zod schema, and turns errors into responses.
- **Controllers** are thin: they parse the request, call one service, and send the response. There's no logic in them.
- **Services** hold all business logic: the priority engine, food actions, usage history, reminders and accounts.
- **Models** are the only code that talks to MongoDB.
- **Jobs** (`jobs/reminderJob.ts`) run the node-cron reminder sweep every 15 minutes.

**How the `shared` package is loaded:** it exports a `source` condition that points at its TypeScript source, so `tsx`, Vite and Vitest use `shared/src` directly with no separate build in development or tests. Production (`node server/dist/index.js`) uses the compiled `shared/dist`, which `npm run build` creates first.

---

## Project structure

```
cook-first/
├── shared/                     @cook-first/shared, used by both client and server
│   └── src/
│       ├── enums.ts            urgency, food status, usage action, reminder type, …
│       ├── api.ts              API request and response types
│       ├── schemas.ts          zod schemas for every request body and query
│       ├── dates.ts            todayInTz, addDays, diffDays, isValidDate, formatDisplay
│       └── dates.test.ts
├── server/                     Express API
│   └── src/
│       ├── config/             env variables, urgency thresholds, database connection
│       ├── middleware/         JWT auth, zod validation, error handling
│       ├── models/             User, FoodItem, UsageRecord, Notification (+ data migrations)
│       ├── services/           all business logic: food, usage, reminders, auth, priority engine, clock
│       ├── controllers/        thin: parse → call service → respond
│       ├── routes/             REST routes under /api
│       ├── jobs/               node-cron reminder sweep
│       ├── tests/              API, unit, rules and structure tests
│       ├── copy.ts             reminder message wording
│       ├── app.ts              Express app (helmet, CORS, JSON, routes)
│       └── index.ts            starts the database, server and jobs
├── client/                     React app
│   └── src/
│       ├── api/                API client: one function per endpoint
│       ├── stores/             Zustand stores: auth, food, notifications (+ toast)
│       ├── pages/              one file per screen (9 screens)
│       ├── components/         FoodCard, UrgencyBadge, FoodForm, ActionSheet, AppShell, AuthLayout, UI parts
│       ├── mocks/              MSW handlers for frontend tests
│       ├── lib/                small helpers: quantity/time formatting, shared-schema form checks
│       ├── test/               frontend tests
│       └── copy.ts             every piece of expiry wording in the interface
├── e2e/                        Playwright end-to-end tests
├── docs/screenshots/           screenshots used in this README
├── .github/workflows/ci.yml    CI pipeline
├── docker-compose.yml          local MongoDB
├── render.yaml                 API deployment (Render)
├── client/vercel.json          web app deployment (Vercel)
├── eslint.config.js
└── playwright.config.ts
```

---

## Getting started

### Prerequisites

- **Node.js 20.19 or later**, with npm. `.nvmrc` pins 20.19.0.
- **One of the following for the database:**
  - **Docker Desktop.** Recommended: `docker compose up -d`.
  - **Nothing.** The API can start a built-in MongoDB instead. It uses more memory, and on first run it downloads the MongoDB program (~780 MB).
  - **A MongoDB Atlas connection string.**

### Install and run

```bash
git clone https://github.com/rugvailabs/cook_first.git cook-first
cd cook-first
npm install
cp server/.env.example server/.env        # optional: the defaults work for development
```

**Database: pick one**

```bash
# A) Docker (recommended)
docker compose up -d
#    then in server/.env:
#    MONGO_URI=mongodb://localhost:27017/cook-first

# B) Built-in: leave MONGO_URI empty. Data is kept in server/.data/.
```

**Start the app.** Use two terminals:

```bash
npm run dev:server     # API     → http://localhost:4000/api
npm run dev:client     # web app → http://localhost:5173
```

Open http://localhost:5173 and create an account.

> **Running the client on a different port?** The browser calls the API directly, so add that address to `CLIENT_ORIGIN` in `server/.env`, for example `CLIENT_ORIGIN=http://localhost:5173,http://localhost:5180`.

---

## Configuration

### `server/.env`

| Variable | Default | Required in production | Description |
|---|---|---|---|
| `PORT` | `4000` | No | API port |
| `MONGO_URI` | *(empty = built-in database)* | **Yes** | MongoDB connection string |
| `JWT_SECRET` | development-only value | **Yes** | Key for signing login tokens (HS256). Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `7d` | No | How long a login lasts |
| `CLIENT_ORIGIN` | `http://localhost:5173` | **Yes** | The web app's address, allowed by CORS (comma-separate several) |

In production the server **refuses to start** if `MONGO_URI` or `JWT_SECRET` is missing.

### `client/.env`

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | Full address of the API, for example `https://cook-first-api.onrender.com/api` |

`.env.example` files are committed for both. The real `.env` files are git-ignored.

---

## Scripts

Run these from the repository root:

| Command | What it does |
|---|---|
| `npm run dev:server` | Start the API with auto-reload |
| `npm run dev:client` | Start the Vite dev server |
| `npm run lint` | ESLint across all three packages |
| `npm run format` / `npm run format:check` | Format with Prettier / check formatting (CI runs the check) |
| `npm run typecheck` | TypeScript check of `shared`, `server` and `client` |
| `npm test` | Unit and API tests: shared (25) + server (167) + client (45) |
| `npm run test:e2e` | Playwright end-to-end tests (16), at 375 px and 1440 px |
| `npm run build` | Build `shared/dist`, `server/dist` and `client/dist` |

---

## Testing

| Suite | Tools | Tests | What it covers |
|---|---|---|---|
| **Dates and reference list** (`shared/src/*.test.ts`) | Vitest | 25 | Valid and invalid dates, leap years (including 2000 and 2100), today in several time zones, month and year ends, daylight-saving weekends, `addDays`/`diffDays` as inverses, the "Thu, 1 Oct" format; the reference list (unique names, valid units, 0–365 lifespans, freezer longer than fridge, search) |
| **API and logic** (`server/src/tests`) | Vitest, Supertest, mongodb-memory-server | 107 | `auth`, `foods`, `notifications`, `security` and `priorityEngine` tests: registration and login, tokens, every validation message, limits and units, expiry never accepted from the client, `/use` (whole, partial, 0, negative or too much), `/waste`, `DELETE`, 409 on closed items, `/usage` paging, each reminder scheduling rule (including a zero-day lifespan), the three exact messages, `dispatchDue` on `GET /foods`, a dispatch failure never breaking the inventory or Cook First, `{n}` worked out at send time, delivery, failures and preferences, cross-user isolation, and all the required priority-engine cases |
| **Phase 1** (`phase1.test.ts`) | Vitest, Supertest | 18 | Household, storage and opened-date fields (defaults, validation, editing, backfill of existing data); bulk add (shared date, per-row storage, reminders, the failing row's field path, all-or-nothing, 1–50 limit); favourites (create, duplicate 409, one-tap add, delete, privacy); undo for every action (quantity, status, reminders and usage record restored; stepping back; nothing to undo; 10-minute limit; other users get 404) |
| **API contract** (`api.test.ts`) | Vitest, Supertest | 14 | Only the agreed error codes, never a stack trace, 500 is `INTERNAL`, database validation errors are 400, login 401 message, exact register messages, user and food response shapes, priority order and summary, `cook-first` matched before `/:id`, reminders scheduled on create and rescheduled only when dates change, pending reminders deleted on close, old routes removed |
| **Wording guard** (`foodSafetyCopy.test.ts`) | Vitest | 5 | Scans every `.ts`/`.tsx` file in `client/src`, `server/src` and `shared/src`, comments included, for the banned phrases. Fails on the word "safe" in either copy file, or on expiry wording outside the copy files. Checks the required estimate line. |
| **Project rules** (`rules.test.ts`) | Vitest, Supertest | 11 | Every database query carries the user's ID; the query-string `userId` is ignored; pure priority engine; bcrypt cost 12; passwords never returned or logged; `.env` ignored; helmet; CORS; rate limit of 20 per 15 minutes |
| **Server structure** (`structure.test.ts`) | Vitest | 12 | The `server/src` folders; thin controllers; only models talk to MongoDB; no `new Date()` in date logic; dates only from `shared`; hourly node-cron job; env variable names and defaults; the threshold of 3 exists only in `config/urgency.ts` (checked across client, server and shared); expiry calculated in the food service with no Mongoose hook |
| **Frontend** (`client/src/test`) | Vitest, React Testing Library, MSW | 45 | Dashboard order and labels, empty state, signing out when the login expires, Cook First filter, partial use, form validation and preview, the required estimate line, all five remaining-days phrasings, colour always paired with a label, exactly seven units, notes, reminders marked read when the screen opens; the dashboard header, 3-item Cook First with "See all", and empty texts; Add Food defaults, the unit dropdown, the "Add note" link and the preview format; reference suggestions (including following the storage location), storage sent with the item, one-tap favourites, Undo instead of confirmations, bulk add (reference fill, one request, per-row errors); the Reminders error state; plus client structure checks |
| **End-to-end** (`e2e/`) | Playwright in Chrome | 16 | 8 journeys, each run at **375 px phone size** and **desktop size (1440×900)** |

The seven end-to-end journeys:

1. **The spec journey:** sign up → add chicken (1-day lifespan) and eggs (8-day) → Cook First shows only the chicken → mark it used → it has disappeared from both the dashboard and Cook First
2. Register → add food → Cook First → mark used → History
3. Partial use, then waste the rest
4. Validation messages and the expected-expiry preview
5. Reminders
6. One user can't see another user's food
7. Reminder settings and log out
8. **Phase 1:** bulk add a haul → waste one and **Undo** it → save a favourite, use it up, and re-add it with one tap

Every page visited is also checked for banned wording, sideways scrolling, and **tap targets under 44 px**.

**Required coverage.** Where each testing requirement is covered:

| Requirement | Test |
|---|---|
| Every priority-engine case | `server/src/tests/priorityEngine.test.ts` |
| Date functions: month ends, year ends, leap years | `shared/src/dates.test.ts` |
| Reminder scheduling rules | `notifications.test.ts` → "scheduling rules" |
| Banned-phrase scan | `foodSafetyCopy.test.ts` |
| Register with a duplicate email → 409 | `auth.test.ts`, `api.test.ts` |
| Login success; wrong password → 401 | `auth.test.ts`, `api.test.ts` |
| Protected routes → 401 with no, malformed or expired token | `auth.test.ts` → "protected endpoints" |
| Create food: every validation rule | `foods.test.ts` → "rejects …" (one case per rule) |
| Expiry recalculated when the added date or lifespan is edited | `foods.test.ts` → "editing" |
| Partial, full and over-quantity use; wasting; deleting | `foods.test.ts` → "usage actions" |
| A closed item → 409 on edit | `foods.test.ts` → "409 CONFLICT …" |
| Closed items leave the inventory and Cook First (used, wasted, removed) | `foods.test.ts` → "a %s item disappears …" |
| Second user → 404 on view, edit, delete, use, waste | `security.test.ts` |
| A disabled preference stops that reminder type | `notifications.test.ts` → "preferences" |
| Dashboard, Add Food and Cook First rendered against MSW | `client/src/test/pages.test.tsx` (handlers in `client/src/mocks/`) |
| End-to-end: sign up → chicken + eggs → only chicken in Cook First → used → gone | `e2e/journey.spec.ts` → "spec journey" |

Test databases live in git-ignored `.test-db-*` folders inside the project, not the system temp folder, and are deleted afterwards. The end-to-end run uses its own ports (API 4100, web 5174), so it never touches your data.

> **Low disk space on the system drive?** Chrome creates a temporary profile for every Playwright test. If that drive is nearly full, point the temp folder elsewhere for the run. For example, in Git Bash: `TMP="$PWD/.tmp" TEMP="$PWD/.tmp" npm run test:e2e` (`.tmp/` is git-ignored).

---

## How it works

### Expected expiry and urgency

```
expiryDate    = addDays(addedDate, lifespanDays)                  calculated in services/foodService.ts
remainingDays = diffDays(today, expiryDate)                       today = todayInTz(user.timeZone)
```

| Remaining days | Urgency | Label | Colour | In Cook First | Card text |
|---|---|---|---|---|---|
| more than 3 | `NOT_URGENT` | Not urgent | green | No | "5 days left" |
| 1 – 3 | `APPROACHING_EXPIRY` | Use soon | amber | Yes | "2 days left", "1 day left" |
| 0 | `DUE` | Expected expiry today | orange | Yes | *(the label already says it)* |
| below 0 | `OVERDUE` | Past expected expiry | red | Yes | "1 day past expected expiry", "4 days past expected expiry" |

- **Urgency is calculated every time items are read and is never stored**, so it rolls over at midnight on its own.
- **The threshold of 3 is one constant**, `APPROACHING_EXPIRY_DAYS` in `server/src/config/urgency.ts`. It isn't hard-coded anywhere else, including the client's wording, and a test enforces this.
- **Urgency always has a text label as well as a colour**, on badges, summary tiles and reminders.

### Priority engine

`prioritise(items, today)` in `server/src/services/priorityEngine.ts` is a pure function with no database, Express or clock:

1. Keep only `ACTIVE` items, and add remaining days and urgency to each.
2. Sort by **expiry date** (earliest first), then **added date**, then **ID compared as strings**. `YYYY-MM-DD` strings sort in date order.
3. Return **`{ items, cookFirst, summary }`**:
   - `items`: the full sorted list
   - `cookFirst`: the `APPROACHING_EXPIRY`, `DUE` and `OVERDUE` items, in the same order
   - `summary`: the count for each urgency state, plus `total`

### Recording what happened

| Action | Request | Effect on the item | Usage record |
|---|---|---|---|
| Used it all | `POST /foods/:id/use` with no quantity (or the whole quantity) | Closed as `USED` | `USED` with the quantity that was left |
| Used some | `POST /foods/:id/use` `{quantity}` below what's left | Quantity reduced; stays active | `PARTIALLY_USED` |
| Threw it away | `POST /foods/:id/waste` | Closed as `WASTED` | `WASTED` with the quantity that was left |
| Remove | `DELETE /foods/:id` → 204 | Closed as `REMOVED` (kept, not deleted) | `REMOVED` with the quantity that was left |

Every closing action sets `closedAt` and deletes the item's pending reminders. A quantity of 0, a negative quantity, or more than is left is rejected with 400. Any action on an item that's already closed returns **409 CONFLICT "This item is no longer active."**

### Reminders

Reminders are **in-app only** for the MVP.

**Scheduling.** Whenever an item is created, or its added date or lifespan changes, its pending reminders are deleted and one is created for each type the user has enabled (`scheduledDateFor` in `services/notificationService.ts`):

| Type | Scheduled for | Created only if |
|---|---|---|
| `APPROACHING_EXPIRY` | 3 days before expiry, or today if that has passed | that date is before the expiry date |
| `DUE` | the expiry date | the expiry date is today or later |
| `OVERDUE` | the day after expiry, or today if that has passed | always |

**Delivery.** `dispatchDue(user)` marks the user's pending reminders as sent once their scheduled date has arrived in the user's time zone, provided the item is still active and that type is still enabled. It fills in the message from `server/src/copy.ts`, with `{n}` worked out at the moment of sending:
- "{name}: expected expiry in {n} days. Consider using it soon." ("1 day" when n is 1)
- "{name}: expected expiry is today."
- "{name} is past its expected expiry. Check it before using."

A failed send is marked `FAILED` and retried until it has been attempted 3 times.

`dispatchDue` runs:
- at the start of `GET /notifications`
- at the start of `GET /foods`
- **hourly** through node-cron (`0 * * * *`)

In `GET /foods` it's wrapped so that any reminder failure is only logged: it can never affect the inventory or the Cook First list.

**Feed.** Paginated: pages of up to 50 reminders (`SENT` or `FAILED`), newest first, with the total and the unread count. The Reminders screen has "Load more". `readAt` stays empty until the user opens the Reminders screen, which calls `POST /notifications/read-all`. New ones still show a "New" tag during that visit.

---

## Screens

The app is mobile-first and tested at **375 px** wide. Buttons, links and fields are all at least 44 px tall (the Playwright tests check this on every screen). Every screen has loading, empty and error states. Any 401 response clears the saved token and returns to the login page.

| Screen | What it shows |
|---|---|
| **Sign up / Log in** | Email and password (plus name on sign-up). The time zone is captured silently. Errors appear next to each field. On success, the dashboard opens. |
| **Dashboard** | **Header:** your name, a bell with the unread count, and a settings icon. **Summary bar:** past · today · use soon · not urgent. **Cook First:** the top 3 urgent items with "See all" ("Nothing urgent right now." when none). **Full list** in priority order ("Your fridge is empty. Add your first item." when empty). **Add food:** a fixed button. |
| **Add food** | One short form: name (focused), quantity (1), unit dropdown (pcs), added date (today, never in the future), lifespan quick picks 1/2/3/5/7/14 plus a number box, and notes behind "Add note". A live preview such as "Expected expiry: Thu, 1 Oct (2 days left)", then the disclaimer. Saving returns to the dashboard with a short confirmation. |
| **Food details** | Every field (including where it's kept and the opened date), plus expected expiry, remaining days and urgency. Active items can be edited, saved as a **favourite**, or marked **Used all**, **Used some** (asks for a quantity), **Wasted** or **Remove**, each with **Undo** afterwards. Closed items are read-only. |
| **Cook First** | Urgent items in priority order: name, quantity, unit, expected expiry, remaining days, urgency and notes, with **Used** (all or some) and **Wasted** buttons, plus the disclaimer. "Nothing needs attention right now." when nothing is urgent. |
| **Bulk add** | Rows of name, quantity, unit, lifespan and where it's kept, sharing one added date. Picking a reference food fills in the rest. Errors show on the exact row. |
| **Reminders** | Newest first, 50 at a time with "Load more". Everything is marked read when the screen opens. |
| **Settings** | Name and email (read-only), the three reminder switches, a link to History, and Log out. |
| **History** | Usage records newest first: food, action, quantity and date, with "Load more". |

---

## Dates and time zones

- **Every food date is a `"YYYY-MM-DD"` string, never a timestamp.** This covers `addedDate`, `expiryDate`, a reminder's `scheduledDate` and a usage record's `date`. Event times such as `sentAt` or `closedAt` are still timestamps.
- **Each user has an IANA time zone**, such as `Asia/Kolkata`. The sign-up form captures it silently from the browser, and it's updated when the user signs in.
- **The server never calls `new Date()` for date logic.** "Today" always comes from `clock.today(user.timeZone)`, which uses `todayInTz`. Only `services/clock.ts` reads the system time, and a test enforces this.
- **`shared/src/dates.ts` provides five functions**, all doing their arithmetic at **UTC midnight** so daylight-saving changes can never shift a day:

| Function | Example |
|---|---|
| `todayInTz(timeZone, now?)` | `todayInTz('Asia/Kolkata')` → `"2026-09-30"` |
| `addDays(date, n)` | `addDays('2026-09-29', 4)` → `"2026-10-03"` |
| `diffDays(from, to)` | `diffDays('2026-09-29', '2026-10-03')` → `4` |
| `isValidDate(value)` | `isValidDate('2026-02-30')` → `false` |
| `formatDisplay(date)` | `formatDisplay('2026-10-01')` → `"Thu, 1 Oct"` |

---

## Data model

MongoDB collections:

| Collection | Fields |
|---|---|
| **users** | `householdId` (every user starts in their own household), `name` (1–50 characters), `email` (stored in lowercase, unique), `passwordHash` (bcrypt, never returned), `timeZone` (IANA, default `UTC`), `notificationPreferences {approachingExpiry, due, overdue}` (all default `true`) |
| **fooditems** | `userId` (exactly one owner), `householdId` (the owner's), `storage` (`FRIDGE`/`FREEZER`/`PANTRY`, default `FRIDGE`), `openedDate` (`YYYY-MM-DD` or null; not in the future or before `addedDate`), `name` (1–60), `quantity` (> 0), `unit` (`pcs`/`g`/`kg`/`ml`/`l`/`pack`/`bunch`), `addedDate` (`YYYY-MM-DD`, not in the future in the user's time zone), `lifespanDays` (whole number 0–365), `expiryDate` (= `addedDate` + `lifespanDays`), `notes` (optional, ≤ 200), `status` (`ACTIVE`/`USED`/`WASTED`/`REMOVED`, default `ACTIVE`), `closedAt` (set when it stops being active) |
| **usagerecords** | `userId`, `foodId`, `action` (`USED`/`PARTIALLY_USED`/`WASTED`/`REMOVED`), `date` (`YYYY-MM-DD` in the user's time zone), `quantityUsed`, `unit` (copied from the item), plus `foodName`, `quantityRemaining` and `createdAt` |
| **favourites** | `userId`, `name`, `nameKey` (lower-case, unique per user), `quantity`, `unit`, `lifespanDays`, `storage` |
| **notifications** | `userId`, `foodId`, `type` (`APPROACHING_EXPIRY`/`DUE`/`OVERDUE`), `scheduledDate` (`YYYY-MM-DD`), `status` (`PENDING`/`SENT`/`FAILED`, default `PENDING`), `message`, `sentAt`, `readAt` (empty until the Reminders screen is opened), `attempts` (starts at 0), plus `expiryDate` and `lastError` |

**The expiry date is calculated in `services/foodService.ts`** when an item is created and whenever its added date or lifespan changes. There's deliberately no Mongoose hook, because hooks don't run on update queries. Any expiry date sent by the client is ignored.

**Indexes:**
- `fooditems {userId, status}` and `{userId, expiryDate}`
- `users.email` (unique)
- `notifications {userId, foodId, type, expiryDate}` (unique, so no duplicate reminders)
- `usagerecords {userId, date, createdAt}`

**Migrations:** `models/migrations.ts` runs at start-up and is safe to run repeatedly. It:
- converts food dates saved before v2.0 to `YYYY-MM-DD` strings
- gives existing users a household and copies it onto their items (v2.5)
- sets missing `storage` to `FRIDGE` and `openedDate` to null (v2.5)
- removes out-of-date indexes

The household ID, storage location and opened date were added **ahead of the later phases**, so shared households, location-based lifespans and the "Opened" action won't need another migration.

**Stored in the browser:** only the login token and basic profile (`localStorage`, through Zustand `persist`), cleared at sign-out.

---

## API reference

Base URL: `http://localhost:4000/api` (`VITE_API_URL`). Requests and responses are JSON. Every route except register and login (and the `/health` check) needs `Authorization: Bearer <token>`. The auth middleware attaches the user's ID, time zone and reminder preferences to the request. It returns **401** if the token is missing, invalid or expired, or if the user no longer exists. Types are in `shared/src/api.ts`, and request schemas in `shared/src/schemas.ts`.

**Responses:**
- **Users:** `{id, name, email, timeZone, notificationPreferences}`
- **Food items:** their stored fields (`id, name, quantity, unit, addedDate, lifespanDays, expiryDate, notes, status, closedAt, createdAt, updatedAt`) plus `remainingDays` and `urgency`. For a closed item, both are `null`.

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| POST | `/auth/register` | `{name, email, password (8+), timeZone}` | `201 {token, user}` | 400, 409 email taken |
| POST | `/auth/login` | `{email, password}` | `200 {token, user}` | 400, 401 "Email or password is incorrect." |
| GET | `/auth/me` | | `{user}` | 401 |
| GET | `/foods` | | `{today, summary, items}`: active items in priority order; `summary` has a count for each urgency state plus `total` | 401 |
| GET | `/foods/cook-first` | | `{today, items}`: urgent items only. Registered before `/foods/:id`. | 401 |
| POST | `/foods` | `{name, quantity, unit, addedDate, lifespanDays, notes?, storage?, openedDate?}` | `201 FoodItem`, with reminders scheduled | 400 |
| POST | `/foods/bulk` | `{addedDate, storage?, items: [{name, quantity, unit, lifespanDays, storage?, notes?}]}` (1–50) | `201 {items}`. All or nothing; errors name the row, e.g. `items.2.name` | 400 |
| POST | `/foods/:id/undo` | | `FoodItem`: the item's most recent action is reversed and its usage record deleted (within 10 minutes) | 404, 409 |
| GET | `/foods/:id` | | `FoodItem`, active or closed | 404 if missing or another user's |
| PUT | `/foods/:id` | any food fields | `FoodItem`. Changing `addedDate` or `lifespanDays` recalculates `expiryDate` and reschedules reminders. | 400, 404, 409 |
| POST | `/foods/:id/use` | `{quantity?}` | `{food, usageRecord}`: no quantity (or all of it) → `USED`; less → `PARTIALLY_USED` | 400 for 0, negative or too much; 404; 409 |
| POST | `/foods/:id/waste` | | `{food, usageRecord}`: closed as `WASTED` | 404, 409 |
| DELETE | `/foods/:id` | | `204`: soft-deleted as `REMOVED` | 404, 409 |
| GET | `/usage` | `?limit=20&offset=0` (defaults) | `{items, total, counts}`, newest first | 400 |
| GET | `/notifications` | `?limit=50&offset=0` (defaults; max 50) | Sends due reminders, then `{items, total, unread}`: `SENT` or `FAILED`, newest first | 400, 401 |
| POST | `/notifications/read-all` | | `204`: all marked as read | 401 |
| GET | `/favourites` | | `{items}` in name order | 401 |
| POST | `/favourites` | `{name, quantity, unit, lifespanDays, storage?}` | `201 Favourite` | 400, 409 name already a favourite |
| DELETE | `/favourites/:id` | | `204` | 404 |
| POST | `/favourites/:id/add` | | `201 FoodItem` added today | 404 |
| PUT | `/notifications/preferences` | `{approachingExpiry?, due?, overdue?}` | preferences; pending reminders of any turned-off type are deleted | 400 |

**Also available** (used by the app):
- `GET /health`
- `PUT /auth/me` (name, time zone)
- `GET /notifications/unread-count` (the bell badge)
- `GET /notifications/preferences`

**Errors** always look like this, and never include a stack trace:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Lifespan must be a whole number of days from 0 to 365.", "field": "lifespanDays" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid input (includes `field`). A database-level validation error is also a 400, never a 500. |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired token; deleted user; wrong email or password |
| 404 | `NOT_FOUND` | Item doesn't exist *or belongs to another user* |
| 409 | `CONFLICT` | Email already registered; "This item is no longer active." |
| 429 | `RATE_LIMITED` | More than 20 requests to `/auth/*` in 15 minutes from one IP address (from the security rules) |
| 500 | `INTERNAL` | Anything unexpected: a generic message; details are only in the server log |

**Validation messages** (defined once in `MESSAGES`, `shared/src/schemas.ts`, and used by the API and the forms):

| Field | Message |
|---|---|
| Food name | Food name is required. |
| Quantity | Quantity must be a positive number. |
| Unit | Choose a unit from the list. |
| Added date | Added date must be a valid date that isn't in the future. |
| Lifespan | Lifespan must be a whole number of days from 0 to 365. |
| Email | Enter a valid email address. |
| Password | Password must be at least 8 characters. |

---

## Project rules

These rules must never be broken. Each one is enforced in code and checked by an automated test.

| Rule | How it's enforced | Test |
|---|---|---|
| **Never suggest food is fit to eat.** The banned phrases (listed in the wording-guard test) must not appear anywhere. | All expiry wording lives in `client/src/copy.ts` (interface) and `server/src/copy.ts` (reminder messages). | `foodSafetyCopy.test.ts` scans every `.ts`/`.tsx` file in `client/src`, `server/src` and `shared/src`, ignoring case. It fails on any banned phrase, on "safe" in either copy file, or on expiry wording outside the copy files. Playwright also scans every rendered page. |
| **Add Food and Cook First show:** *"Expected expiry is an estimate to help you plan. Always check your food before eating it."* | `estimateNote` in `client/src/copy.ts`, shown by the `EstimateNote` component. | Client tests; Playwright journeys 1 and 3 |
| **Users only ever see their own data.** | The identity comes only from the verified JWT. Every query on food items, usage records and reminders includes `userId` (including `save()`/`deleteOne()`, via Mongoose's `shardKey`). Another user's item returns **404**, not 403. | `rules.test.ts` records every MongoDB operation in a full journey and fails on any without the user's ID; `security.test.ts`; Playwright journey 5 |
| **Prioritisation is deterministic.** | `prioritise(items, today)` in `services/priorityEngine.ts` is a pure function with no database, Express or clock imports. | `priorityEngine.test.ts` (running twice gives identical output; shuffled input gives the same order); `rules.test.ts` |
| **Urgency is never stored; the threshold of 3 is one constant.** | `APPROACHING_EXPIRY_DAYS` in `server/src/config/urgency.ts`. Urgency is calculated on every read. | `structure.test.ts` scans client, server and shared for a hard-coded 3 |
| **Urgency is shown with a colour and a text label, never colour alone.** | `URGENCY_STYLE` (colour) always rendered with `urgencyCopy` (label). | Client tests |
| **The expiry date is calculated in the food service and never accepted from the client.** | `foodService.ts` (no Mongoose hook). The shared schemas drop unknown fields. | `foods.test.ts`, `structure.test.ts`, client test |
| **Server-side validation is what counts.** | Shared zod schemas run in `middleware/validate.ts`. The client runs the same schemas only so errors show instantly. | `foods.test.ts`, `auth.test.ts` |
| **Passwords: bcrypt cost 12, never logged or returned.** | `services/passwordHash.ts`. Responses never include `passwordHash`. The request log records only method, route, status and time. | `rules.test.ts`, `auth.test.ts` |
| **Secrets only from environment variables.** | `config/env.ts`. `.env.example` files are committed; `.env` is git-ignored. Production refuses to start without `JWT_SECRET` and `MONGO_URI`. | `rules.test.ts`, `structure.test.ts` |
| **Helmet, CORS limited to the client, sign-in rate limit.** | `app.ts` (helmet, CORS from `CLIENT_ORIGIN`), `routes/index.ts` (20 per 15 minutes per IP address). | `rules.test.ts` |
| **Thin controllers; logic in services; only models talk to MongoDB.** | Request flow: routes → middleware → controllers → services → models. | `structure.test.ts` |
| **Food dates are `YYYY-MM-DD` strings; no `new Date()` in server date logic.** | `shared/src/dates.ts`; `services/clock.ts` is the only reader of the system time. | `dates.test.ts`, `structure.test.ts` |

---

## Security

- **Passwords:** hashed with bcrypt (cost 12) and never stored, logged or returned in plain text. A wrong email and a wrong password give the same response.
- **Login tokens:** JWT, HS256, 7-day expiry. The token carries only the user ID. Expired or tampered tokens are rejected, and the app signs the user out.
- **Access control:** the identity comes only from the verified JWT. Every query on food items, usage records and reminders includes the user's ID. Any `userId` in the body, query string or URL is ignored. Another user's item returns 404.
- **Input:** everything is checked on the server with the shared zod schemas.
- **HTTP:** Helmet headers, CORS limited to `CLIENT_ORIGIN`, a 20 KB request size limit, and `/auth/*` limited to 20 requests per 15 minutes per IP address.
- **Secrets:** read only from environment variables and never committed.

---

## Deployment

The configuration is ready but **nothing has been deployed yet**.

1. **Database: MongoDB Atlas.** Create a free cluster and copy its connection string.
2. **API: Render** (or any Node host). New → Blueprint → select this repo. `render.yaml` builds `shared` and `server`, starts `node server/dist/index.js`, checks `/api/health`, and generates `JWT_SECRET`. Set `MONGO_URI` and `CLIENT_ORIGIN`.
3. **Web app: Vercel.** Import the repo and set the root directory to `client`. Set `VITE_API_URL` to `https://<api-host>/api`.
4. **Finish up.** Put the Vercel address into `CLIENT_ORIGIN` on the API host and redeploy.

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request:
- **install → lint → format check → typecheck → unit and API tests → build**, on Node **20.19** (the minimum) and **24**
- then the Playwright end-to-end suite

---

## Differences from the design documents

These decisions intentionally differ from the original BRD, FRD, SRD and TDD:

| Area | Decision | Why |
|---|---|---|
| Food status | Only `ACTIVE`, `USED`, `WASTED` and `REMOVED` are stored. **Urgency is always calculated when items are read.** `PARTIALLY_USED` is a usage action, not a status. | A stored urgency would go wrong at midnight; a partly used item is still active. |
| Urgency name | `SAFE` is renamed **`NOT_URGENT`** | The word "safe" must never reach the interface. |
| Dates | Stored as **`"YYYY-MM-DD"` strings** and evaluated in each user's time zone | Calendar dates must never shift with time zones or daylight saving. |
| Lifespan and added date | Lifespan **0–365 days**. **Past added dates are allowed; future ones are rejected.** | People log food they bought earlier; a future date is almost always a typo. |
| Deleting | A **soft delete** (status `REMOVED`) that keeps history | Usage history must survive. |
| Another user's item | **404** instead of 403 | Doesn't reveal that the item exists. |
| Usage records | Include the **user's ID**. The `EXPIRED` action is **not built**. `POST /foods/:id/use` works out full or partial use from the quantity. | History is listed per user; items aren't closed without the user's knowledge. |
| New fields | Food items gain **notes** and **closed-at**. Users gain a **time zone**. Notifications gain **type**, **message**, **read-at** and **attempt count**. | Needed by the screens, reminders and retries. |
| New endpoints | **`GET /auth/me`** (current user), **`GET /usage`** (usage history), **`POST /notifications/read-all`** (mark as read) | Not in the TDD's endpoint table. The app also uses `GET /health`, `PUT /auth/me`, `GET /notifications/unread-count` and `GET /notifications/preferences`. |
| Reminders | **In-app only.** Firebase push is postponed. | See the [Roadmap](#roadmap). |
| Pagination | The food list is **not** paginated. **Usage history** (`/usage`, 20 per page) and **notifications** (`/notifications`, 50 per page) are. | A household's active food is small; history grows. |
| `GET /foods` response | `{today, summary, items}` rather than a bare array | The dashboard needs the counts. |

**Out of scope for the MVP:**
- recipes
- barcode and receipt scanning
- AI meal planning
- shared households
- grocery integrations
- push notifications
- analytics dashboards

---

## Build phases

The project was built in these phases; each one is complete.

| Phase | Server | Client | Status |
|---|---|---|---|
| **1. Scaffold** | npm workspaces (`client`, `server`, `shared`); TypeScript, ESLint, Prettier; Express with `/api/health`; MongoDB `docker-compose.yml`; `.env.example` files; CI workflow; shared date functions with tests | Vite app | ✅ |
| **2. Authentication** | User model; register, login and current-user endpoints; JWT middleware, error handler, zod validation middleware, rate limiting; API tests | Sign-up and log-in screens, auth store, protected routes, 401 handling | ✅ |
| **3. Food and priority** | Priority engine and its unit tests first; food item model; food endpoints (except use, waste and delete); API tests including cross-user checks | Dashboard, Add Food, Food Details (view and edit) | ✅ |
| **4. Usage** | Use, waste and delete endpoints; usage record model; usage history endpoint; tests | Action buttons, Cook First, History | ✅ |
| **5. Reminders** | Notification model, scheduling logic, `dispatchDue`, hourly job, preferences endpoint; tests | Bell with count, Reminders screen, Settings | ✅ |
| **6. Polish and ship** | Banned-phrase test; deployment config (`render.yaml`, `client/vercel.json`) | Every empty, loading and error state; Playwright end-to-end tests; this README (setup, environment variables, running tests) | ✅ (deployment itself not yet done; see the [Roadmap](#roadmap)) |

---

## Project status

| Item | Status |
|---|---|
| All MVP functional requirements (FR-AUTH, FOOD, EXP, PRI, UI, NOT, USE, VAL) | ✅ Done |
| Monorepo with `client`, `server` and `shared`; Node 20.19+ | ✅ Done |
| Tests: 25 shared + 167 server + 45 client + 16 end-to-end = **253** | ✅ Passing |
| ESLint, Prettier and typecheck on all packages | ✅ Clean |
| All project rules (see [Project rules](#project-rules)) | ✅ Met, each one checked by a test |
| Phone (375 px) and desktop layouts, 44 px tap targets | ✅ Done, checked in screenshots and by tests |
| Docker MongoDB, Render/Vercel config, CI workflow | ✅ Written. CI hasn't run yet because the code isn't on GitHub. |
| Code on GitHub (`rugvailabs/cook_first`) | ⏳ Not pushed yet: the repo is empty |
| Online deployment | ⏳ Not started |
| Opening on a phone over Wi-Fi | ⏸ Paused: the phone's requests didn't reach the PC |
| Post-MVP Phase 1 (faster entry) | ✅ Done |
| Post-MVP Phases 2–6 | ⏳ Planned (see [Roadmap](#roadmap)) |

---

## Changelog

All notable changes to this project are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org/).

### [Unreleased]
- *Nothing yet.*

### [2.5.0] - 2026-09-29: Data model fields for later phases + Phase 1 (faster entry)
**Added: data model (ahead of later phases)**
- **`householdId`:** on users (each starts in their own household) and food items.
- **`storage`:** `FRIDGE`, `FREEZER` or `PANTRY` on food items, defaulting to `FRIDGE`.
- **`openedDate`:** on food items (optional; not in the future or before the added date).
- **Backfill:** existing data is filled in automatically at start-up.

**Added: Phase 1, faster entry**
- **Reference list** (`shared/src/foodReference.ts`): 43 common foods with suggested lifespans for fridge, freezer and pantry.
  - Add Food suggests matches as you type; picking one fills in the unit and lifespan, and changing "Kept in" follows the suggestion.
  - Suggestions are labelled as planning estimates from the "Cook First reference list" and are always editable.
- **Favourites:** "☆ Save as favourite" on the details screen, and a Favourites strip on Add Food that re-adds an item with one tap. API: `GET/POST /favourites`, `DELETE /favourites/:id`, `POST /favourites/:id/add`.
- **Bulk add:** a screen for a whole shopping haul (up to 50 rows sharing one added date), with reference fill-in and per-row errors. API: `POST /foods/bulk`, all or nothing.
- **Undo:** `POST /foods/:id/undo` reverses an item's most recent action (used, partly used, wasted or removed) within 10 minutes and deletes its usage record.
- **Tests:** 18 server, 6 client, 4 shared, and a Phase 1 end-to-end journey (at 375 px and desktop).

**Changed**
- **Undo replaces confirmation dialogs.** Used all, Wasted and Remove now act at once, and the message offers **Undo** for 7 seconds. The v2.3.0 confirmation step is gone.
- **Validation error fields** now give the full path (for example `items.2.name`) on both the server and the client.
- **Usage-record timestamps** come from the app clock, so the undo window is measured consistently.

### [2.4.0] - 2026-09-29: Testing, build-phase and decisions requirements · `57f099a`
**Added**
- **Prettier:** config (`.prettierrc.json`, `.prettierignore`), `npm run format` and `format:check`, and a **format check step in CI**. The whole codebase was formatted once (layout only).
- **`.gitattributes`:** keeps LF line endings on every OS, so the Prettier check passes on Windows checkouts.
- **Notifications are paginated:** `GET /notifications?limit=50&offset=0` (maximum 50 per page) returns `{items, total, unread}`, and the Reminders screen has "Load more".
- **End-to-end spec journey:** sign up → chicken (1 day) and eggs (8 days) → only chicken in Cook First → mark used → gone from the dashboard and Cook First. Now 7 journeys, 14 tests.
- **More tests:**
  - wasted and removed items leave both lists, alongside used ones
  - century leap years (2000, 2100) and more month- and year-end date cases
  - notification paging
- **README:**
  - a **Build phases** section
  - a **Required coverage** table mapping each testing requirement to its test
  - **Differences from the design documents** rewritten as the agreed decisions, with the out-of-scope list

### [2.3.0] - 2026-09-29: Reminders and screens to spec · `6dfaaf5`
**Changed: reminders**
- **Messages** are now exactly:
  - "{name}: expected expiry in {n} days. Consider using it soon."
  - "{name}: expected expiry is today."
  - "{name} is past its expected expiry. Check it before using."
- **Scheduling rules** are now an explicit, tested function (`scheduledDateFor`).
- **`dispatchForUser` renamed `dispatchDue`.** It now also runs at the start of `GET /foods`, wrapped so a reminder failure can never affect the inventory or Cook First.
- **The node-cron job** now runs **hourly** (`0 * * * *`) instead of every 15 minutes.

**Changed: screens**
- **Dashboard:**
  - the header shows the full name, the bell (at every screen size) and a new settings icon
  - Cook First always shows the top 3 with "See all", or "Nothing urgent right now."
  - the empty list reads "Your fridge is empty. Add your first item."
  - the fixed centre button is now labelled "Add food"
- **Add food:**
  - a unit **dropdown** (defaults to pcs)
  - notes behind an "**Add note**" link
  - the preview reads "Expected expiry: Thu, 1 Oct (2 days left)", with the disclaimer beneath it
- **Food details:** "**Used all**", "**Used some**", "**Wasted**" and "**Remove**" buttons. Closing actions need **one confirmation**, and closed items show a read-only note.
- **Cards** (Cook First and dashboard): **Used** (all or some) and **Wasted** buttons instead of "Update".
- **Cook First empty state:** "Nothing needs attention right now."
- **Settings:** name and email shown as read-only fields, a **History** link, and "**Log out**".
- **History:** "**Load more**", and the action's date.
- **Error states:** the Reminders screen now shows an error instead of "No reminders yet" when loading fails, and Settings shows one if reminder settings can't load.
- **Tap targets:** raised to at least 44 px (chips, inline links, the sidebar logo).

**Added**
- **Server tests** for every scheduling rule, the exact messages, `dispatchDue` on `GET /foods`, reminder-failure isolation, and `{n}` worked out at send time.
- **Client tests** for the dashboard layout, the form defaults and preview, confirmations, and error states.
- **End-to-end tests:** the phone project is now **375 px** wide, and every screenshot also checks for tap targets under 44 px.

### [2.2.0] - 2026-09-29: API contract to spec · `26b783b`
**Breaking**
- **`POST /foods/:id/use`:** now takes `{quantity?}`. No quantity (or all of it) uses the whole item; less logs `PARTIALLY_USED`; 0, negative or too much is a 400. It no longer takes `action`/`quantityUsed`.
- **`POST /foods/:id/waste`:** always closes the whole item as `WASTED`. Partial waste is gone.
- **`GET /usage-records` → `GET /usage`.**
- **`PUT /notifications/read-all` → `POST /notifications/read-all`.** `PUT /notifications/:id/read` was removed.
- **`GET /notifications`:** returns up to 50 `SENT` **or `FAILED`** reminders with the unread count, with no paging.
- **Food items return `expiryDate`** (the stored field name) instead of `expectedExpiryDate`.
- **Error codes limited to** `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`, `INTERNAL` (plus `RATE_LIMITED` from the security rules):
  - a wrong login is now `UNAUTHENTICATED`
  - a closed item is now `CONFLICT` with "This item is no longer active."

**Added**
- **`MESSAGES` in `shared`:** the exact validation messages, used by both the API and the forms.
- **Database validation errors** now return 400 `VALIDATION_ERROR` instead of 500.
- **`api.test.ts` (14 tests):** the error format and codes, no stack traces, response shapes, route order, and reminder scheduling rules.
- **More tests** for `/use`, `/waste`, `DELETE`, the 409 wording and `/usage` defaults.

**Changed**
- **Rescheduling on edit:** `PUT /foods/:id` reschedules reminders only when the added date or lifespan changes.
- **New validation messages:**
  - "Choose a unit from the list."
  - "Added date must be a valid date that isn't in the future." (for invalid and future dates alike)
  - "Lifespan must be a whole number of days from 0 to 365."
- **App:** "Threw it away" is now one tap; the Reminders list shows up to 50 reminders with no "Show older".

### [2.1.0] - 2026-09-29: Data model limits, urgency states and priority engine to spec · `3107802`
**Breaking**
- **Urgency states renamed:** `USE_SOON` → `APPROACHING_EXPIRY`, `DUE_TODAY` → `DUE`, `PAST_EXPECTED_EXPIRY` → `OVERDUE` (in API responses and `shared`).
- **`GET /foods` summary:** now includes `total`.
- **Units restricted to `pcs, g, kg, ml, l, pack, bunch`;** the free-text "Other…" unit is gone.
- **New limits:** lifespan 0–365 days (was 0–3650), food name 60 characters (was 100), user name 50 characters (was 80).

**Added**
- **Notes:** optional, up to 200 characters, on food items. Shown on cards and the details screen; editable, and cleared with an empty string.
- **Priority engine:** `prioritise(items, today)` now returns `{ items, cookFirst, summary }` (with `total`).
- **Required priority-engine tests:** a zero-day lifespan is DUE on the day it's added; running twice gives identical output; chicken, spinach, milk, eggs orders correctly with only chicken and spinach in Cook First; urgency switches exactly at 4, 3, 1, 0 and −1 days.
- **Tests for new limits and fields:** units, name/lifespan/notes limits, the name limit of 50, lowercase email and default settings.
- **Expiry never from the client:** tests show a client-sent expiry date is ignored on create and edit.
- **Structure tests:** the threshold of 3 isn't hard-coded outside `config/urgency.ts` (checked across client, server and shared); there's no Mongoose hook for expiry.
- **Client tests:** the five remaining-days phrasings; colour always paired with a label; seven units; notes; reminders read on opening.

**Changed**
- **Expiry calculation:** now done in `foodService` on create, and on edit when the added date or lifespan changes. The Mongoose `pre('validate')` hook was removed.
- **Threshold constant:** `APPROACHING_EXPIRY_DAYS = 3` in `config/urgency.ts` is the single source. Client wording no longer mentions the number.
- **Remaining-days text:** "{n} days left", "1 day left", "Expected expiry today", "1 day past expected expiry", "{n} days past expected expiry".
- **"Not urgent" colour:** now **green** (was grey). Closed items keep a neutral grey badge.
- **Reminders:** `readAt` is now set when the Reminders screen is opened. The "Mark all as read" button and tap-to-read were removed. New reminders show a "New" tag during that visit.
- **Database model limits:** `FoodItem` (name 60, unit list, quantity > 0, whole-number lifespan 0–365, notes 200) and `User` (name 50) now enforce the same rules at the database level.

### [2.0.0] - 2026-09-29: Monorepo with a shared package; layered server; calendar-date strings · `39b6a2d`
**Breaking**
- **Environment variables renamed:** `MONGODB_URI` → `MONGO_URI` and `CORS_ORIGIN` → `CLIENT_ORIGIN`. `REMINDER_SWEEP_MINUTES` was removed; the job now uses a node-cron schedule.
- **`VITE_API_URL` now defaults to `http://localhost:4000/api`.** The client calls the API directly instead of through the Vite proxy, so any client port other than 5173 must be listed in `CLIENT_ORIGIN`.
- **Food dates are stored as `"YYYY-MM-DD"` strings instead of timestamps.** Existing data is converted automatically at start-up (`models/migrations.ts`).
- **Node.js 20.19 or later required** (`engines`, `.nvmrc`).

**Added**
- **`shared` workspace package** (`@cook-first/shared`), used by both client and server:
  - enums
  - API request and response types
  - zod schemas
  - `dates.ts`, with `todayInTz`, `addDays`, `diffDays`, `isValidDate` and `formatDisplay` ("Thu, 1 Oct"), with 20 tests
- **`server/src/jobs/reminderJob.ts`:** a node-cron job running every 15 minutes.
- **Service layer:** `foodService`, `usageService`, `authService`, and read/update operations in `notificationService`. Controllers are now thin.
- **`services/clock.ts`:** the only reader of the system time; `clock.today(timeZone)` provides every "today".
- **ESLint** (typescript-eslint and react-hooks) and separate `lint` and `typecheck` scripts.
- **CI:** install, lint, typecheck, tests and build on Node 20.19 and 24, then Playwright.
- **New tests:**
  - `structure.test.ts` (11): server folders, thin controllers, only models touch MongoDB, no `new Date()` in date logic, node-cron, env names
  - client structure tests (9): folders, one page per screen, `mocks/`, API default, persisted token, shared schemas
- **Screen files:** `LoginPage.tsx` and `RegisterPage.tsx` are now separate files, sharing `components/AuthLayout.tsx`.
- **`client/src/mocks/`:** MSW handlers and server.

**Changed**
- **bcrypt:** `bcryptjs` → `bcrypt`. Hashes are identical (`$2b$12$…`), so existing accounts still sign in.
- **Tests:** moved from `server/test` into `server/src/tests`.
- **Forms:** the Add Food, Login and Register forms now check input with the shared zod schemas, so their messages match the server's exactly.
- **Date labels:** dates display as "Tue, 29 Sep" everywhere (`formatDisplay`), whatever the device's language.
- **Dependency versions, for Node 20 support:** React Router 8.4 → 7.18, Vitest 5.0 → 4.1, jsdom 30.1 → 27.4, TypeScript 7.0 → 6.0 (needed by ESLint).
- **Test databases:** now stored in git-ignored `.test-db-*` folders inside the project instead of the system temp folder.

**Fixed**
- **Reminder sweep:** it no longer uses `new Date()` for its date window; it uses the calendar day in the earliest time zone.
- **Stale item details:** an item's details could briefly show the previous item's data after moving quickly between items.
- **Escape-key handler:** the action sheet's Escape handler no longer updates a ref during render.

### [1.3.0] - 2026-09-29: Project rules enforced · `7646618`
**Added**
- **Wording guard rewritten to the rules:** scans every `.ts`/`.tsx` file in `client/src` and `server/src` (comments included) for the full list of seven banned phrases (one was missing before). It also fails on the word "safe" in either copy file, and on expiry wording outside the copy files.
- **New `rules.test.ts` (11 tests):**
  - every database query carries the user's ID
  - a query-string `userId` is ignored
  - the priority engine is pure
  - bcrypt cost 12, and passwords are never returned or logged
  - `.env` is ignored
  - helmet, CORS, and the rate limit of 20 per 15 minutes
- **Required estimate line tests:** client tests and Playwright checks for the line on Add Food and Cook First.
- **README:** rewritten as the full project reference, with a [Project rules](#project-rules) section.

**Changed**
- **All expiry wording moved into `client/src/copy.ts`:** about 20 strings from 9 screens.
- **Estimate line:** now exactly *"Expected expiry is an estimate to help you plan. Always check your food before eating it."*
- **Sign-in rate limit:** 20 requests per 15 minutes per IP address (was 30).

**Fixed**
- **Reminder queries without the user's ID:** scheduling and cancelling reminders filtered only by food ID. They now include the user's ID, as do `save()`/`deleteOne()` on food items and reminders.
- **Banned wording in comments:** comments in both copy files contained banned phrases or the word "safe".

### [1.2.0] - 2026-09-29: Desktop layout · `92176f7`
**Added**
- Desktop layout from 1024 px wide:
  - a fixed sidebar
  - a two-column dashboard
  - a two-column Cook First grid
  - reading-width forms
  - a brand panel beside the sign-in and sign-up forms
- Every Playwright journey now runs at phone size and desktop size: 12 tests.

### [1.1.0] - 2026-09-29: End-to-end tests, Docker and deployment config · `e17b113`
**Added**
- **Playwright end-to-end suite:** 6 journeys in real Chrome.
- **Local MongoDB:** `docker-compose.yml`.
- **Deployment config:** `render.yaml` and `client/vercel.json`.
- **CI:** Playwright added to the workflow.

**Fixed**
- **Sideways scrolling:** the Add food page scrolled sideways on phones.
- **Lingering errors:** error messages stayed on screen after the field was corrected.
- **Repetitive cards:** food cards said "Expected expiry" three times.

### [1.0.0] - 2026-09-29: First release (MVP) · `ed9dbc2`
**Added**
- **Accounts:** JWT sign-in, bcrypt password hashing and time-zone capture.
- **Food:** add, edit, view and remove, with expected expiry = added date + lifespan.
- **Priority and Cook First:** the priority engine, four urgency labels and the Cook First list.
- **Dashboard and history:** the dashboard, used / partly used / wasted / removed actions with usage records, and History.
- **Reminders:** in-app reminders with preferences and retries.
- **Privacy and wording:** each user sees only their own data, plus the "safe"-wording test.
- **Development:** a built-in MongoDB fallback.
- **Tests and CI:** 76 server tests, 10 client tests and a CI workflow.

---

## Roadmap

**Before any later phase:** push the code to GitHub (`git push -u origin main` from your own terminal), and deploy (see [Deployment](#deployment)).

Post-MVP phases are built one at a time, each with its tests passing before the next begins. Every phase keeps two rules:
1. **AI features read the Cook First order but never change it.**
2. **No screen, notification or AI-generated text ever calls food safe.** The wording guard scans all of `client/src`, `server/src` and `shared/src`.

| Phase | Scope | Status | Needs from you |
|---|---|---|---|
| **0. Data model** | Household ID, storage location, opened date | ✅ Done (v2.5.0) | – |
| **1. Faster entry** | Reference list with suggested lifespans · favourites with one-tap re-add · bulk add · Undo instead of confirmations | ✅ Done (v2.5.0) | – |
| **2. Realistic estimates** | Fridge, freezer and pantry lifespans · an "Opened" action that shortens expected expiry · lifespan suggestions learned from your own history | Next | – |
| **3. Better reminders** | Installable web app (PWA) · push notifications · a daily digest at a chosen time · "Used" and "Snooze" buttons in notifications | Planned | A decision on push delivery: self-hosted Web Push (VAPID keys) or Firebase Cloud Messaging |
| **4. Using the food** | Leftovers as new short-lifespan items · a shopping list that warns about food already at home · AI recipe suggestions from Cook First · a weekly meal plan | Planned | An AI provider and API key for recipes |
| **5. Insights** | Used-versus-wasted dashboard · optional prices showing money saved or lost · a weekly summary with tips | Planned | – |
| **6. Sharing and scanning** | Shared households with invites and an activity log · voice entry · barcode scanning · receipt scanning · grocery integrations · multiple languages · dark mode · data export · account deletion | Planned | Barcode data source (e.g. Open Food Facts), receipt OCR service, which grocery partners (they need commercial API access), and which languages |

---

## Keeping this README up to date

Every change to the project should update this file in the same commit:

1. Add an entry under **[Unreleased]** in the [Changelog](#changelog), using **Added**, **Changed**, **Fixed**, **Removed** or **Breaking**.
2. When releasing, rename **[Unreleased]** to the new version and date, then add the commit hash.
3. Update [Project status](#project-status), [Roadmap](#roadmap) and any other affected sections: features, API, configuration, test counts.
4. If the screens change, run `npm run test:e2e` and copy the new screenshots from `e2e/screenshots/` into `docs/screenshots/`.
