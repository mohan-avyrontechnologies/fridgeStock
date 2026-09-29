# Cook First: Perishable Food Cooking Prioritiser

A mobile-first web app that helps a household use perishable food before it goes to waste. You log each item with a lifespan in days. The app works out its **expected expiry**, sorts everything so the most urgent food comes first, and shows a daily **Cook First** list.

> **Food-safety boundary:** *Expected expiry is an estimate to help you plan. Always check your food before eating it.* The app never claims that food is fit to eat.

| | |
|---|---|
| **Status** | MVP complete. Not yet deployed. |
| **Version** | 1.3.0 (see the [Changelog](#changelog)) |
| **Specifications** | PFCP BRD v2.0, FRD v1.0, SRD v1.0, TDD v1.0 (internal documents, not stored in this repo) |
| **Repository** | `github.com/rugvailabs/cook_first` |

---

## Contents

1. [Screenshots](#screenshots)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Project structure](#project-structure)
5. [Getting started](#getting-started)
6. [Configuration](#configuration)
7. [Scripts](#scripts)
8. [Testing](#testing)
9. [How it works](#how-it-works)
10. [Data model](#data-model)
11. [API reference](#api-reference)
12. [Project rules](#project-rules)
13. [Security](#security)
14. [Deployment](#deployment)
15. [Differences from the design documents](#differences-from-the-design-documents)
16. [Project status](#project-status)
17. [Changelog](#changelog)
18. [Roadmap](#roadmap)
19. [Keeping this README up to date](#keeping-this-readme-up-to-date)

---

## Screenshots

These screenshots are captured automatically by the Playwright test suite.

**Phone (Pixel 7)**

| Dashboard | Cook First | Recording what happened | Add food |
|---|---|---|---|
| ![Dashboard on a phone](docs/screenshots/mobile-02-dashboard.png) | ![Cook First on a phone](docs/screenshots/mobile-03-cook-first.png) | ![Action sheet on a phone](docs/screenshots/mobile-04-action-sheet.png) | ![Add food on a phone](docs/screenshots/mobile-07-add-food.png) |

**Desktop (1440 × 900)**

| Dashboard | Sign in |
|---|---|
| ![Dashboard on desktop](docs/screenshots/desktop-02-dashboard.png) | ![Sign in on desktop](docs/screenshots/desktop-10-login.png) |

---

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register and log in with email and password. JWT sessions last 7 days, and passwords are hashed with bcrypt. |
| **Add food** | Name, quantity, unit, added date and lifespan (days). Quick-pick buttons for units, "Today" / "Yesterday" and 1–14 day lifespans. The form shows a live expected-expiry preview. There is also a "Save and add another" button. |
| **Expected expiry** | Added date + lifespan. It is recalculated whenever the added date or lifespan is edited. |
| **Urgency labels** | Not urgent (> 3 days) · Use soon (1–3 days) · Expected expiry today (0) · Past expected expiry (< 0). |
| **Priority order** | Sorted by expected expiry, then added date, then item ID, so the same data always gives the same order. |
| **Cook First** | Every active item that isn't "Not urgent", most urgent first. |
| **Dashboard** | Counts for each label, a "Needs attention" section and the full list of food. |
| **Recording what happened** | Used it all · Used some · Threw it away (all or part) · Remove. Each one is saved as a usage record. |
| **History** | Every usage record, newest first, with totals for each action. |
| **Reminders** | In-app reminders when an item reaches "Use soon", on its expected-expiry day, and the day after. Each type can be turned off. |
| **Privacy** | Each user only ever sees their own food, history and reminders. |
| **Responsive** | Phone layout with a bottom navigation bar. From 1024 px wide: a sidebar and a two-column layout. |

---

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| **Frontend** | React | 19.3 |
| | TypeScript | 7.0 |
| | Tailwind CSS | 4.3 |
| | Zustand (app state) | 5.0 |
| | React Router | 8.4 |
| | Vite (build and dev server) | 8.3 |
| **Backend** | Node.js | 24 |
| | Express | 5.2 |
| | TypeScript, run with `tsx` in development | 7.0 |
| | Mongoose | 9.10 |
| | Zod (input validation) | 4.6 |
| | jsonwebtoken (HS256) | 9.0 |
| | bcryptjs | 3.0 |
| | Helmet, CORS, express-rate-limit | 8.3 / 2.8 / 8.7 |
| **Database** | MongoDB | 8.2 |
| **Testing** | Vitest, Supertest, mongodb-memory-server | 5.0 / 7.3 / 11.3 |
| | React Testing Library, MSW, jsdom | 16.3 / 2.15 / 30.1 |
| | Playwright | 1.63 |
| **DevOps** | Docker Compose, GitHub Actions, Render, Vercel | |

The project is one repository with an npm workspace for each half: `client/` and `server/`.

---

## Project structure

```
cook-first/
├── client/                     React app
│   ├── public/                 static assets (icon)
│   ├── src/
│   │   ├── api/                API client and shared types
│   │   ├── components/         AppShell (nav), FoodCard, FoodForm, ActionSheet, UI parts
│   │   ├── lib/                date helpers
│   │   ├── pages/              Dashboard, Cook First, Add food, Food details, Reminders, History, Settings, Sign in
│   │   ├── stores/             Zustand stores: auth, food, notifications, toast
│   │   ├── test/               component tests (MSW)
│   │   └── copy.ts             all expiry wording in one place
│   └── vercel.json             Vercel deployment config
├── server/                     Express API
│   ├── src/
│   │   ├── config/             environment variables, urgency thresholds
│   │   ├── controllers/        auth, food, notification and usage controllers
│   │   ├── middleware/         JWT auth, validation, error handling
│   │   ├── models/             User, FoodItem, UsageRecord, Notification
│   │   ├── routes/             REST routes under /api
│   │   ├── services/           priority engine, reminders, tokens, password hashing
│   │   ├── utils/              calendar dates, clock, errors
│   │   ├── copy.ts             server-side wording for reminders
│   │   └── validation.ts       Zod schemas
│   └── test/                   API and unit tests
├── e2e/                        Playwright end-to-end tests
├── docs/screenshots/           screenshots used in this README
├── .github/workflows/ci.yml    CI pipeline
├── docker-compose.yml          local MongoDB
├── render.yaml                 Render deployment config for the API
└── playwright.config.ts
```

---

## Getting started

### Prerequisites

- **Node.js 24+** and npm 11+
- **One of the following for the database:**
  - **Docker Desktop.** This is the recommended option.
  - **Nothing.** The API can start a built-in MongoDB. It uses more memory, and on first run it downloads the MongoDB program (~780 MB).
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
#    then set in server/.env:
#    MONGODB_URI=mongodb://localhost:27017/cook-first

# B) Built-in: leave MONGODB_URI empty.
#    Data is kept in server/.data/ and survives restarts.
```

**Start the app.** Use two terminals:

```bash
npm run dev:server     # API     → http://localhost:4000/api
npm run dev:client     # web app → http://localhost:5173
```

Open http://localhost:5173 and create an account.

> **Port already in use?** Run the client on another port, for example `cd client && npx vite --port 5180`.
>
> **Opening it on a phone on the same Wi-Fi:** run `cd client && npx vite --host 0.0.0.0 --port 5180` and open `http://<this-PC's-IP>:5180`. The Wi-Fi network must be set to *Private* in Windows, and the router must allow devices to reach each other.

---

## Configuration

### `server/.env`

| Variable | Default | Required in production | Description |
|---|---|---|---|
| `MONGODB_URI` | *(empty = built-in database)* | **Yes** | MongoDB connection string |
| `PORT` | `4000` | No | API port |
| `JWT_SECRET` | development-only value | **Yes** | Secret key for signing login tokens. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `7d` | No | How long a login lasts |
| `CORS_ORIGIN` | `http://localhost:5173` | **Yes** | Browser addresses allowed to call the API (comma-separated) |
| `REMINDER_SWEEP_MINUTES` | `15` | No | How often the background reminder job runs |

In production the server **refuses to start** if `MONGODB_URI` or `JWT_SECRET` is missing.

### `client/.env`

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `/api` (sent through the Vite dev server) | Full API address in production, for example `https://cook-first-api.onrender.com/api` |

---

## Scripts

Run these from the repository root:

| Command | What it does |
|---|---|
| `npm run dev:server` | Start the API with auto-reload |
| `npm run dev:client` | Start the Vite dev server |
| `npm test` | Server tests (91) + client tests (12) |
| `npm run test:e2e` | Playwright end-to-end tests (12) |
| `npm run lint` | TypeScript type-check of both halves |
| `npm run build` | Production build of the server (`server/dist`) and client (`client/dist`) |

---

## Testing

| Suite | Tools | Tests | What it covers |
|---|---|---|---|
| **API and logic** (`server/test`) | Vitest, Supertest, in-memory MongoDB | 75 | Registration and login, protected routes, bad or expired tokens, adding/editing/removing food, every validation rule, urgency and sorting (including ties), Cook First, time zones, used / partly used / wasted / removed, history, reminder scheduling, delivery, retries and preferences, cross-user isolation |
| **Wording guard** (`server/test/foodSafetyCopy.test.ts`) | Vitest | 5 | Scans every `.ts`/`.tsx` file in `client/src` and `server/src`, comments included, for the banned phrases. Fails if the word "safe" appears in either copy file, or if expiry wording appears outside the copy files. Also checks the required estimate line. |
| **Project rules** (`server/test/rules.test.ts`) | Vitest, Supertest | 11 | Every database query carries the user's ID; the query-string `userId` is ignored; the priority engine is pure; bcrypt cost 12; passwords never returned or logged; `.env` ignored; helmet headers; CORS limited to the client; rate limit of 20 per 15 minutes |
| **Frontend** (`client/src/test`) | Vitest, React Testing Library, MSW | 12 | Dashboard order and labels, empty state, signing out when the login expires, Cook First filter, partial use, form validation and expected-expiry preview, and the required estimate line on Add Food and Cook First |
| **End-to-end** (`e2e/`) | Playwright in Chrome | 12 | 6 journeys, each run at **phone size (Pixel 7)** and **desktop size (1440×900)**; see the list below |

The six end-to-end journeys:

1. Register → add food → Cook First → mark used → History
2. Partial use and partial waste
3. Validation messages and the expected-expiry preview
4. Reminders
5. One user can't see another user's food
6. Reminder settings and sign-out

Every page visited is also checked for banned wording and for sideways scrolling. The Add Food and Cook First pages must show the required estimate line.

The end-to-end run starts its own API (port 4100, throwaway database) and client (port 5174), so it never touches your data. Screenshots are saved to `e2e/screenshots/<mobile|desktop>/` (not committed).

---

## How it works

### Expected expiry and urgency

```
expectedExpiryDate = addedDate + lifespanDays
remainingDays      = expectedExpiryDate − today   (in the user's own time zone)
```

| Remaining days | Label | Colour | In Cook First |
|---|---|---|---|
| more than 3 | Not urgent | neutral grey | No |
| 1 – 3 | Use soon | amber | Yes |
| 0 | Expected expiry today | orange | Yes |
| below 0 | Past expected expiry | red | Yes |

- **Dates are calendar days** (`YYYY-MM-DD`), not timestamps, so time zones and daylight-saving changes never shift an item by a day.
- **"Today" uses each user's time zone.** It's saved at sign-up and updated at each sign-in.
- **Remaining days and labels are calculated on every request, not stored**, so they roll over at midnight on their own.
- **The thresholds are configurable** in `server/src/config/urgency.ts`.
- **"Not urgent" is grey, not green**, so it doesn't suggest "fine to eat".

### Priority engine

`server/src/services/priorityEngine.ts` has no database access and doesn't read the clock, so it always gives the same result for the same input:

1. Leave out used, wasted and removed items.
2. Sort by **expected expiry**, then **added date**, then **item ID**.
3. Work out remaining days and the label for each item.
4. **Cook First** = every item at or above "Use soon".

### Recording what happened

| Action | Effect on the item | Usage record |
|---|---|---|
| Used it all | Closed as `USED` | `USED` with the full quantity |
| Used some | Quantity reduced; stays active | `PARTIALLY_USED` (the amount must be less than what's left) |
| Threw it away: all | Closed as `WASTED` | `WASTED` |
| Threw it away: part | Quantity reduced; stays active | `WASTED` with that amount |
| Remove | Closed as `REMOVED` (kept, not deleted) | `REMOVED` |

### Reminders

- Up to three per item: **approaching** (3 days before), **due** (on the day) and **overdue** (the day after).
- **Rescheduled** when an item's dates change, and **cancelled** when it's used, wasted or removed.
- **An item added late only gets the reminder for the stage it's already in**, not a burst of old ones.
- **Delivered** when the user opens the app, and by a background job every 15 minutes.
- **Failed deliveries** are saved as `FAILED` and retried up to 3 times. The food lists never depend on reminders.

---

## Data model

MongoDB collections:

| Collection | Fields |
|---|---|
| **users** | `name`, `email` (unique), `passwordHash` (bcrypt), `timeZone`, `notificationPreferences {approachingExpiry, due, overdue}` |
| **fooditems** | `userId`, `name`, `quantity`, `unit`, `addedDate`, `lifespanDays`, `expiryDate` (calculated), `status` (`ACTIVE`/`USED`/`WASTED`/`REMOVED`), `closedAt` |
| **usagerecords** | `userId`, `foodId`, `action`, `date`, `quantityUsed`, `quantityRemaining`, `foodName`, `unit` (a copy taken at the time) |
| **notifications** | `userId`, `foodId`, `type`, `expiryDate`, `scheduledDate`, `status` (`PENDING`/`SENT`/`FAILED`), `attempts`, `lastError`, `message`, `sentAt`, `readAt` |

**Indexes:**
- `fooditems {userId, status}` and `{userId, expiryDate}`
- `users.email` (unique)
- `notifications {foodId, type, expiryDate}` (unique, so no duplicate reminders)
- `usagerecords {userId, date}`

**Stored in the browser:** only the login token and basic profile (`localStorage`), cleared at sign-out.

---

## API reference

Base URL: `/api`. Every route except register, login and health needs `Authorization: Bearer <token>`.

| Method | Path | Body / query | Success |
|---|---|---|---|
| GET | `/health` | | `{ok: true}` |
| POST | `/auth/register` | `{name, email, password, timeZone?}` | `201 {token, user}` |
| POST | `/auth/login` | `{email, password, timeZone?}` | `200 {token, user}` |
| GET | `/auth/me` | | `{user}` |
| PUT | `/auth/me` | `{name?, timeZone?}` | `{user}` |
| GET | `/foods` | | `{today, summary, items}` in priority order |
| GET | `/foods/cook-first` | | `{today, items}` |
| POST | `/foods` | `{name, quantity, unit, addedDate, lifespanDays}` | `201 FoodItem` |
| GET | `/foods/:id` | | `FoodItem` |
| PUT | `/foods/:id` | any food fields | `FoodItem` |
| DELETE | `/foods/:id` | | `204`; the item is closed as `REMOVED`, not deleted |
| POST | `/foods/:id/use` | `{action: "USED" \| "PARTIALLY_USED", quantityUsed?}` | `{food, usageRecord}` |
| POST | `/foods/:id/waste` | `{quantityUsed?}` | `{food, usageRecord}` |
| GET | `/usage-records` | `?limit=20&offset=0` | `{items, total, counts}` |
| GET | `/notifications` | `?limit=30&offset=0` | `{items, total, unread}` |
| GET | `/notifications/unread-count` | | `{unread}` |
| PUT | `/notifications/:id/read` | | the notification |
| PUT | `/notifications/read-all` | | `204` |
| GET / PUT | `/notifications/preferences` | `{approachingExpiry?, due?, overdue?}` | preferences |

**Errors** always look like this:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Lifespan must be zero or a positive number of days.", "field": "lifespanDays" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid name, quantity, unit, date or lifespan |
| 401 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | Missing, bad or expired token; wrong email or password |
| 404 | `NOT_FOUND` | Item doesn't exist *or belongs to another user* |
| 409 | `CONFLICT` / `ITEM_CLOSED` | Email already registered; the item is already used, wasted or removed |
| 429 | `RATE_LIMITED` | More than 20 requests to `/auth/register` or `/auth/login` in 15 minutes from one IP address |

---

## Project rules

These rules must never be broken. Each one is enforced in code and checked by an automated test.

| Rule | How it's enforced | Test |
|---|---|---|
| **Never suggest food is fit to eat.** The banned phrases (listed in the wording-guard test) must not appear anywhere. | All expiry wording lives in `client/src/copy.ts` (interface) and `server/src/copy.ts` (reminder messages). | `foodSafetyCopy.test.ts` scans every `.ts`/`.tsx` file in `client/src` and `server/src`, ignoring case. It fails on any banned phrase, on the word "safe" in either copy file, or on expiry wording outside the copy files. The Playwright tests also scan every rendered page. |
| **Add Food and Cook First show:** *"Expected expiry is an estimate to help you plan. Always check your food before eating it."* | `estimateNote` in `client/src/copy.ts`, shown by the `EstimateNote` component. | Client tests `required estimate line`; Playwright journeys 1 and 3 |
| **Users only ever see their own data.** | The identity comes only from the verified JWT (`middleware/auth.ts`). Every query on food items, usage records and reminders includes `userId`. Another user's item returns **404**, not 403. | `rules.test.ts` records every MongoDB operation in a full journey and fails on any without the user's ID; `security.test.ts`; Playwright journey 5 |
| **Prioritisation is deterministic.** | `services/priorityEngine.ts` is a pure function with no database, Express or clock imports. Ties are broken by added date, then ID. | `priorityEngine.test.ts` (shuffled input gives the same order); `rules.test.ts` (import check) |
| **Server-side validation is what counts.** | Zod schemas in `server/src/validation.ts`. Checks in the browser only make forms faster to use. | `foods.test.ts` (every invalid input rejected by the API) |
| **Passwords: bcrypt cost 12, never logged or returned.** | `services/passwordHash.ts`. API responses never include `passwordHash`. The request log records only method, route, status and time. | `rules.test.ts`, `auth.test.ts` |
| **Secrets only from environment variables.** | `config/env.ts`. `server/.env.example` and `client/.env.example` are committed; `.env` is git-ignored. Production refuses to start without `JWT_SECRET` and `MONGODB_URI`. | `rules.test.ts` |
| **Helmet, CORS limited to the client, sign-in rate limit.** | `app.ts` (helmet, CORS from `CORS_ORIGIN`), `routes/index.ts` (`AUTH_RATE_LIMIT`: 20 per 15 minutes per IP address). | `rules.test.ts` (headers, allowed and blocked origins, the 21st request gets 429) |

---

## Security

- **Passwords:** hashed with bcrypt (12 rounds) and never stored or logged in plain text. Wrong email and wrong password give the same response.
- **Login tokens:** JWT, HS256, 7-day expiry. The token carries only the user ID. Expired or tampered tokens are rejected, and the app signs the user out.
- **Access control:** the user's identity comes only from the verified JWT. Every database query on food items, usage records and reminders includes the logged-in user's ID, including `save()`/`deleteOne()` on loaded records (via Mongoose's `shardKey` option). Any `userId` in the body, query string or URL is ignored. Another user's item returns 404, so the API doesn't reveal which items exist.
- **Input:** everything is checked on the server with Zod. Checks in the browser only make forms faster to use.
- **HTTP:** Helmet security headers, CORS limited to the client's address (`CORS_ORIGIN`), a 20 KB request size limit, and `/auth/*` limited to 20 requests per 15 minutes per IP address.
- **Secrets:** read from environment variables and never committed (`.env` is git-ignored).

---

## Deployment

The configuration is ready but **nothing has been deployed yet**.

1. **Database: MongoDB Atlas.** Create a free cluster and copy its connection string.
2. **API: Render.** New → Blueprint → select this repo. `render.yaml` builds `server/`, starts `node server/dist/index.js`, checks `/api/health`, and generates `JWT_SECRET`. Set `MONGODB_URI` and `CORS_ORIGIN`.
3. **Web app: Vercel.** Import the repo and set the root directory to `client`. `client/vercel.json` handles the build and page routing. Set `VITE_API_URL` to `https://<render-app>.onrender.com/api`.
4. **Finish up.** Put the Vercel address into `CORS_ORIGIN` on Render and redeploy.

**CI:** GitHub Actions runs type-check → tests → build → Playwright on every push and pull request.

---

## Differences from the design documents

| Area | Design documents say | This app does | Why |
|---|---|---|---|
| Stored status | Store `APPROACHING_EXPIRY`, `DUE` and `OVERDUE` | Store only `ACTIVE`/`USED`/`WASTED`/`REMOVED`; calculate urgency on every request | A stored urgency goes wrong at midnight |
| Urgency name | `SAFE` | `NOT_URGENT` | The app must never use the word "safe" |
| Another user's item | 403 | 404 | Doesn't reveal that the item exists |
| Usage record | `recordId, foodId, action, date, quantityUsed` | Also `userId`, name/unit copy, `quantityRemaining` | History is listed per user and stays readable after later edits |
| `GET /foods` | Returns a plain list | Returns `{today, summary, items}` | The dashboard needs the counts |
| Added date | Backdating "only if intentionally supported" | Past dates allowed; future dates rejected | People log food they bought earlier |
| `EXPIRED` action | Recorded by the system | Not recorded; the item stays "Past expected expiry" until the user acts | Avoids closing items without the user knowing |
| Push notifications | Firebase (optional) | In-app reminders only | Needs a Firebase project; see the [Roadmap](#roadmap) |

---

## Project status

| Item | Status |
|---|---|
| All MVP functional requirements (FR-AUTH, FOOD, EXP, PRI, UI, NOT, USE, VAL) | ✅ Done |
| Server, client and end-to-end tests (115 total) | ✅ Passing |
| All project rules (see [Project rules](#project-rules)) | ✅ Met, each one checked by a test |
| Phone and desktop layouts | ✅ Done and checked in screenshots |
| Docker MongoDB, Render/Vercel config, CI workflow | ✅ Written |
| Code on GitHub (`rugvailabs/cook_first`) | ⏳ Not pushed yet: the repo is empty |
| Online deployment | ⏳ Not started |
| Opening on a phone over Wi-Fi | ⏸ Paused: the phone's requests didn't reach the PC |
| Firebase push notifications | ⏳ Not started (optional in the SRD) |

---

## Changelog

All notable changes to this project are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org/).

### [Unreleased]
- *Nothing yet.*

### [1.3.0] - 2026-09-29: Project rules enforced · `7646618`
**Added**
- **Wording guard rewritten to the rules:** scans every `.ts`/`.tsx` file in `client/src` and `server/src` (comments included) for the full list of seven banned phrases (one was missing before). It also fails on the word "safe" in either copy file, and on expiry wording written anywhere outside the copy files.
- **New `rules.test.ts` (11 tests):**
  - every database query on food items, usage records and reminders carries the user's ID
  - a `userId` in the query string is ignored
  - the priority engine is pure
  - bcrypt cost 12, and passwords are never returned or logged
  - `.env` is ignored and secrets come only from environment variables
  - helmet headers, CORS allow-list, and the rate limit of 20 per 15 minutes
- **Required estimate line tests:** client tests and Playwright checks for the line on Add Food and Cook First.
- **README:** rewritten as the full project reference (screenshots, changelog, roadmap), with a new [Project rules](#project-rules) section.

**Changed**
- **All expiry wording moved into `client/src/copy.ts`:** about 20 strings that were written directly in Dashboard, Cook First, Add Food, food cards, food details, Reminders, Settings and the sign-in pages.
- **Estimate line:** now exactly *"Expected expiry is an estimate to help you plan. Always check your food before eating it."*, shown on Add Food, Cook First and the other screens.
- **Sign-in rate limit:** `/auth/register` and `/auth/login` now allow 20 requests per 15 minutes per IP address (was 30).

**Fixed**
- **Reminder queries without the user's ID:** scheduling and cancelling reminders filtered only by food ID. They now include the user's ID, and `save()`/`deleteOne()` on food items and reminders now include it too.
- **Banned wording in comments:** comments in both copy files contained banned phrases or the word "safe"; they're reworded.

### [1.2.0] - 2026-09-29: Desktop layout · `92176f7`
**Added**
- Desktop layout from 1024 px wide:
  - a fixed sidebar (Add food, Home, Cook First with its count, Reminders with its unread count, History, Settings, and the user's name)
  - a two-column dashboard with larger summary tiles
  - a two-column Cook First grid
  - reading-width forms and lists
  - a brand panel beside the sign-in and sign-up forms
- Every Playwright journey now runs at both phone size (Pixel 7) and desktop size (1440×900): 12 tests.

**Changed**
- On phones, the bell and bottom navigation are unchanged. On desktop, the sidebar replaces them.

### [1.1.0] - 2026-09-29: End-to-end tests, Docker and deployment config · `e17b113`
**Added**
- Playwright end-to-end suite: 6 journeys in real Chrome, with its own API, database and ports, plus checks for "safe" wording and sideways scrolling.
- `docker-compose.yml` for a local MongoDB with a small memory cap.
- `render.yaml` (API) and `client/vercel.json` (web app), with deployment steps.
- Playwright in the CI workflow.

**Fixed**
- The Add food page scrolled sideways on phones (a browser default on the unit buttons' `<fieldset>`).
- Error messages stayed on screen after the field was corrected.
- Food cards repeated "Expected expiry" three times.

### [1.0.0] - 2026-09-29: First release (MVP) · `ed9dbc2`
**Added**
- **Accounts:** register and log in with JWT; bcrypt password hashing; the user's time zone is saved.
- **Food:** add, edit, view and remove, with expected expiry = added date + lifespan.
- **Priority:** the priority engine (expected expiry, then added date, then ID), four urgency labels, and the Cook First list.
- **Dashboard:** urgency counts, "Needs attention" and the full list.
- **Recording what happened:** used, partly used, wasted and removed, each saved as a usage record, plus a History screen.
- **Reminders:** in-app reminders (approaching, due, overdue) with preferences, retries and a 15-minute background job.
- **Privacy:** each user only sees their own data.
- **Wording:** all expiry wording in one place per side, plus a test that bans "safe".
- **Development:** a built-in MongoDB fallback, so no database install is needed.
- **Tests and CI:** 76 server tests, 10 client tests and a GitHub Actions workflow.

---

## Roadmap

Planned or possible next steps, in rough priority order:

| # | Item | Notes |
|---|---|---|
| 1 | **Push the code to GitHub** | `git push -u origin main` from your own terminal, signed in as `rugvailabs` |
| 2 | **Deploy online** | MongoDB Atlas + Render + Vercel (see [Deployment](#deployment)); this also gives phone access over HTTPS |
| 3 | **Phone access over Wi-Fi** | Check the phone and PC are on the same network, or use a temporary public link |
| 4 | **Firebase push notifications** | Add a push channel to `deliveryChannel` in `notificationService.ts`; needs a Firebase project and keys |
| 5 | **Python backend (optional)** | Possible rewrite in FastAPI + Beanie + Pydantic with the same API, so the React app wouldn't change; the SRD/TDD would need updating |
| 6 | **Future ideas from the BRD** | Recipe suggestions, barcode and receipt scanning, shared household accounts, waste reports |

---

## Keeping this README up to date

Every change to the project should update this file in the same commit:

1. Add an entry under **[Unreleased]** in the [Changelog](#changelog), using **Added**, **Changed**, **Fixed** or **Removed**.
2. When releasing, rename **[Unreleased]** to the new version and date, then add the commit hash.
3. Update [Project status](#project-status), [Roadmap](#roadmap) and any other affected sections: features, API, configuration, test counts.
4. If the screens change, run `npm run test:e2e` and copy the new screenshots from `e2e/screenshots/` into `docs/screenshots/`.
