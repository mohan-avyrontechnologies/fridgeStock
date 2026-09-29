# Cook First: Perishable Food Cooking Prioritiser

A mobile-first web app for logging perishable food. It works out each item's **expected expiry** (added date + lifespan in days) and shows what to cook first.

Built from the BRD/FRD/SRD/TDD set (PFCP-*-1.0/2.0).

| Layer | Stack |
|---|---|
| Client (`client/`) | React 19, TypeScript, Tailwind CSS v4, Zustand, React Router, Vite |
| API (`server/`) | Node.js, Express 5, TypeScript, Mongoose, Zod, JWT (HS256), bcrypt |
| Database | MongoDB |
| Tests | Vitest + Supertest + mongodb-memory-server (API), Vitest + Testing Library + MSW (client), Playwright (end-to-end) |

## Running locally

```bash
npm install
cp server/.env.example server/.env   # optional; defaults work for development
npm run dev:server                   # API on http://localhost:4000/api
npm run dev:client                   # app on http://localhost:5173
```

**Database.** The lighter option is Docker:

```bash
docker compose up -d                      # MongoDB 8 on 127.0.0.1:27017, capped at 256 MB cache
# then in server/.env:
MONGODB_URI=mongodb://localhost:27017/cook-first
```

If `MONGODB_URI` is empty, the API instead starts an **embedded MongoDB** that stores its data in `server/.data/`, so you don't need Docker or a local `mongod`. The first start downloads the MongoDB binary (~780 MB, then cached). In production, `MONGODB_URI` and `JWT_SECRET` are required and the server refuses to start without them.

```bash
npm test          # server (76 tests) + client (10 tests)
npm run test:e2e  # Playwright, 6 journeys in Chrome at a Pixel 7 viewport
npm run build
```

The end-to-end run starts its own API (on port 4100, with a throwaway in-memory database) and its own client (on port 5174), so it doesn't touch your dev data. Locally it uses your installed Chrome; in CI it uses Playwright's Chromium. It covers:

- register → add food → Cook First → mark used → history
- partial use and partial waste
- validation messages and the expected-expiry preview
- reminders
- cross-user isolation
- settings
- that no page says "safe" or scrolls sideways

Screenshots go to `e2e/screenshots/` (git-ignored).

## Deploying (SRD §9)

1. **Database:** create a MongoDB Atlas cluster (the free tier is enough) and copy its connection string.
2. **API on Render:** New → Blueprint → select this repo. `render.yaml` builds `server/`, runs `node server/dist/index.js` and checks `/api/health`. It generates `JWT_SECRET` for you. Set `MONGODB_URI` (Atlas) and `CORS_ORIGIN` (the Vercel URL from step 3).
3. **Client on Vercel:** import the repo and set **Root Directory** to `client`. `client/vercel.json` handles the install, the build and the rewrites that make client-side routes work. Set `VITE_API_URL` to `https://<your-render-app>.onrender.com/api`.
4. Redeploy the API once the Vercel URL is known, so `CORS_ORIGIN` matches it.

CI (`.github/workflows/ci.yml`) runs typecheck → unit and API tests → build → Playwright on every push and pull request. Render and Vercel deploy on their own when `main` changes.

## How it behaves

**Expected expiry.** `expectedExpiryDate = addedDate + lifespanDays`. Dates are calendar days (`YYYY-MM-DD`), never instants. "Today" is worked out in the user's own time zone, which is saved at sign-up and updated on each sign-in. Remaining days, and therefore urgency, are calculated on every read, so they roll over at midnight without a background job.

| Remaining days | Label |
|---|---|
| > 3 | Not urgent |
| 1–3 | Use soon |
| 0 | Expected expiry today |
| < 0 | Past expected expiry |

**Priority order** (`server/src/services/priorityEngine.ts`, pure and deterministic): active items only, sorted by expected expiry, then added date, then id. **Cook First** is every item that isn't "Not urgent". Thresholds are in `server/src/config/urgency.ts`.

**Usage actions**, each saved as a `UsageRecord`:
- **Used it all** closes the item as `USED`.
- **Used some** lowers the quantity and keeps the item active. The amount must be less than what's left.
- **Threw it away** closes the item as `WASTED`. If only part of it was thrown away, the quantity goes down and the item stays active.
- **Remove** closes the item as `REMOVED`. `DELETE /foods/:id` is a soft close, so history is kept.

**Reminders (in-app).** Each active item gets up to three: when it reaches "Use soon", on its expected-expiry day, and the day after. They are rescheduled whenever an item's dates change, cancelled when the item is closed, and filtered by the user's preferences. They are delivered when the user opens the app and by a background sweep every 15 minutes. A failed delivery is stored as `FAILED` and retried up to 3 times. Inventory views never depend on reminders.

**Data isolation.** Every query filters on the `userId` that the JWT middleware attaches to the request. A `userId` in the request body is ignored. Another user's item returns **404**, the same as a missing one.

**Food-safety boundary.** All expiry wording lives in `client/src/copy.ts` and `server/src/copy.ts`. `server/test/foodSafetyCopy.test.ts` scans both codebases and fails if "safe", "guaranteed", "good until" or "fresh until" appears outside comments. "Not urgent" is shown in neutral grey rather than green so it doesn't read as "fine to eat".

## API (`/api`)

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{name, email, password, timeZone?}` → 201 `{token, user}`; 409 if the email is already used |
| POST | `/auth/login` | `{email, password, timeZone?}` → `{token, user}`; 401 |
| GET/PUT | `/auth/me` | current user; update `name`, `timeZone` |
| GET | `/foods` | `{today, summary, items}`: active items in priority order |
| GET | `/foods/cook-first` | `{today, items}` |
| POST | `/foods` | `{name, quantity, unit, addedDate, lifespanDays}` |
| GET/PUT/DELETE | `/foods/:id` | DELETE closes the item as REMOVED (204) |
| POST | `/foods/:id/use` | `{action: USED \| PARTIALLY_USED, quantityUsed?}` |
| POST | `/foods/:id/waste` | `{quantityUsed?}` |
| GET | `/usage-records` | history, paginated (`limit`, `offset`), with per-action counts |
| GET | `/notifications` | delivered reminders, paginated, plus the unread count |
| GET | `/notifications/unread-count` | |
| PUT | `/notifications/:id/read`, `/notifications/read-all` | |
| GET/PUT | `/notifications/preferences` | `{approachingExpiry, due, overdue}` |

Errors always have the shape `{error: {code, message, field?}}`.

## Where this differs from the design documents

- **Stored status.** Only the lifecycle status (`ACTIVE/USED/WASTED/REMOVED`) is stored. The time-based states (`APPROACHING_EXPIRY`, `DUE`, `OVERDUE`) are calculated on each read so they can't go out of date. Partial use is recorded as a usage action, and the item stays `ACTIVE` (as FRD §6.2 describes).
- **Urgency code.** The TDD's `SAFE` state is called `NOT_URGENT`, so the word "safe" never appears anywhere.
- **Other users' items.** These return 404 rather than the TDD's 403, so the API doesn't reveal which ids exist.
- **UsageRecord fields.** A `UsageRecord` also stores `userId` (for scoping) plus a snapshot of the name and unit.
- **`GET /foods` response.** It returns `{today, summary, items}` rather than a bare array, because the dashboard needs the counts.
- **Future added dates.** These are rejected. Backdated dates are allowed.
- **`EXPIRED` usage action.** This is not generated. An item that passes its expected expiry stays on the list as "Past expected expiry" until the user acts on it.
- **Push notifications (Firebase Cloud Messaging) are not built.** The SRD marks them "future/optional", and they need a Firebase project and keys. Reminders are delivered in-app. Delivery goes through `deliveryChannel` in `server/src/services/notificationService.ts`, so a push channel can be added there without changing scheduling.
