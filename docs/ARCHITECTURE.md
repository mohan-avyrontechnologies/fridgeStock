# Architecture

How FridgeStock is put together: the moving parts, the data, and the rules the code keeps. For endpoints see [API.md](API.md); for what people see, [FEATURES.md](FEATURES.md).

---

## System overview

```
client (React)  ──HTTP/JSON──▶  server (Express)  ──Mongoose──▶  MongoDB
      │                               │
      └──────── @fridgestock/shared ───┘   enums · API types · zod schemas · dates.ts
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

**How the `shared` package is loaded:** it exports a `source` condition that points at its TypeScript source, so `tsx`, Vite and Vitest use `shared/src` directly with no separate build in development or tests. Production (`node server/dist/index.js`) uses the compiled `shared/dist` (`dist/src` and `dist/data`), which `npm run build` creates first.

**Shared data:** the catalog, category defaults, banned phrases, each locale's day/month order, the server's wording and the validation messages are JSON files in `shared/data`, read by the TypeScript code and by the Python server that is being built (`server-py`, see [PYTHON_MIGRATION.md](PYTHON_MIGRATION.md)). `shared/test-cases` holds the cases both languages must pass.

---

## Tech stack

The project is a **TypeScript monorepo** using npm workspaces, with three packages: `client`, `server` and `shared`. It requires **Node.js 20.19 or later** (20.19 is the minimum that Vite and Mongoose support).

| Layer | Technology | Version |
|---|---|---|
| **Frontend** (`client`) | React | 19.3 |
| | Service worker + web app manifest (installable app, push notifications; no extra library) | |
| | Vite (build and dev server) | 8.3 |
| | React Router | 7.18 |
| | `@capacitor/haptics` (taps for completed actions in the apps) | 8 |
| | Tailwind CSS (design tokens in `index.css`), `lucide-react` icons, `@fontsource` fonts (Bricolage Grotesque, Figtree) | 4.3 |
| | @zxing/browser (reads barcodes from the camera where the browser has no `BarcodeDetector`; loaded only when needed) | 0.2 |
| | Capacitor (Android and iOS apps) with `@capacitor/camera`, `@capacitor/push-notifications`, `@capacitor-mlkit/barcode-scanning` and `@aparajita/capacitor-secure-storage` | 8 |
| | Zustand (app state; the login token is saved in `localStorage` through its `persist` middleware) | 5.0 |
| **Backend** (`server`) | Express | 5.2 |
| | Mongoose (MongoDB) | 9.10 |
| | jsonwebtoken (HS256) | 9.0 |
| | bcrypt | 6.0 |
| | zod (validation) | 4.6 |
| | node-cron (scheduled jobs) | 4.6 |
| | multer (photo uploads, held in memory, 5 MB limit) / sharp (checks and re-encodes photos) | 2.4 / 0.35 |
| | firebase-admin (Firebase Cloud Messaging: push to the Android and iOS apps) | 14 |
| | web-push (self-hosted Web Push with VAPID keys) | 3.6 |
| | @anthropic-ai/sdk (Claude API, structured JSON outputs); model `claude-sonnet-5-5` | 0.129 |
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

## Data model

MongoDB collections:

| Collection | Fields |
|---|---|
| **users** | `householdId` (every user starts in their own household), `name` (1–50 characters), `email` (stored in lowercase, unique), `passwordHash` (bcrypt, never returned), `timeZone` (IANA, default `UTC`), `notificationPreferences {approachingExpiry, due, overdue}` (all default `true`), `reminderDelivery` (`mode`: `DIGEST`/`EACH_ITEM`, default `DIGEST`; `hour`: 0–23, default 8), `currency` (`USD`/`EUR`/`GBP`/`CAD`/`AUD`/`INR`, default `USD`; display only), `savePhotos` (default true), `lastDigestDate`, `alerts` (`sound`, `vibration`, `quietHours {enabled, start, end}`; defaults on, on, on 22:00 to 07:00), `mealReminders` (`breakfast`, `lunch`, `dinner`, each `{enabled, time}`; defaults off at 07:30, 12:30 and 19:30) |
| **fooditems** | `userId` (who added it), `householdId` (the household that owns it; every member sees it), `storage` (`FRIDGE`/`FREEZER`/`PANTRY`, default `FRIDGE`), `openedDate` (`YYYY-MM-DD` or null; not in the future or before `addedDate`), `name` (1–60), `quantity` (> 0), `unit` (`pcs`/`g`/`kg`/`ml`/`l`/`pack`/`bunch`), `addedDate` (`YYYY-MM-DD`, not in the future in the user's time zone), `lifespanDays` (whole number 0–365), `expiryDate` (= `addedDate` + `lifespanDays`), `notes` (optional, ≤ 200), `status` (`ACTIVE`/`USED`/`WASTED`/`REMOVED`, default `ACTIVE`), `closedAt` (set when it stops being active), `snoozedUntil` (`YYYY-MM-DD` or null; set by Snooze on a notification), `leftover` (default false), `photoAt` (when its photo was set, or null; the photo itself is in GridFS), `price` and `priceQuantity` (optional; what that quantity cost, 0–100,000; the API shows `price` for the quantity left), `lifespanBeforeOpened` (null unless opened), `enteredLifespanDays` and `enteredStorage` (what the user typed, used to learn their usual lifespans), `enteredByUser` (false when the app estimated the lifespan; only typed lifespans are learned from), `expirySource` (`PRINTED_DATE`/`LEARNED`/`CATALOG`/`CATEGORY_DEFAULT`/`FALLBACK`/`USER`, default `USER`), `estimateExplanation` (≤ 240), `printedDate` and `printedDateType` (`USE_BY`/`BEST_BEFORE`/`EXPIRY`/`UNKNOWN`, or null), `sourceBeforeOpened` and `explanationBeforeOpened` (so "Opened" can be undone) |
| **usagerecords** | `userId` (who did it), `householdId` (the food's household; the history is shared), `foodId`, `action` (`USED`/`PARTIALLY_USED`/`WASTED`/`REMOVED`), `date` (`YYYY-MM-DD` in the user's time zone), `quantityUsed`, `unit` (copied from the item), plus `foodName`, `quantityRemaining`, `value` (the price of what was used or wasted, or null) and `createdAt` |
| **favourites** | `userId`, `name`, `nameKey` (lower-case, unique per user), `quantity`, `unit`, `lifespanDays`, `storage` |
| **notifications** | `userId`, `foodId`, `type` (`APPROACHING_EXPIRY`/`DUE`/`OVERDUE`), `scheduledDate` (`YYYY-MM-DD`), `status` (`PENDING`/`SENT`/`FAILED`, default `PENDING`), `message`, `sentAt`, `readAt` (empty until the Reminders screen is opened), `attempts` (starts at 0), plus `expiryDate`, `lastError` and `pushedAt` (when it went out as a push, alone or in a digest) |
| **pushsubscriptions** | `userId`, `endpoint` (unique per user; never returned by the API), `keys.p256dh`, `keys.auth`, `browser` (e.g. "Chrome on Android"), `lastUsedAt`, `createdAt`. Deleted when the push service answers 404 or 410, on "Turn off on this device", and at logout. |
| **shoppingitems** | `userId` (who added it), `householdId` (the list is shared), `name` (1–60), `quantity` and `unit` (optional), `checked`, `createdAt` |
| **mealplanentries** | `userId` (who first planned it), `householdId`, `date` (`YYYY-MM-DD`), `meal` (`breakfast`/`lunch`/`dinner`, default `dinner`; unique per household, day and meal), `title` (1–80), `foodIds` (the household's items, up to 10) |
| **mealreminderlogs** | `userId`, `householdId`, `date` (the person's day), `meal` (unique per user, day and meal: so a meal reminder goes once a day), `sentAt`, `content` (what it said: the plan, the recipe, or the items), `recipeTitle` (so no recipe is used for two meals in a day), `snoozedUntil` ("Snooze 30 min"). Cleared after 7 days. |
| **recipeideacaches** | `userId` (who asked), `householdId`, `date`, `mealType` (unique per household, day and meal type), `recipes`. Cleared after 3 days. |
| **foodPhotos.files / foodPhotos.chunks** (GridFS) | Two files per photographed item (`full`, `thumb`; WebP, no EXIF), with `metadata {householdId, foodId, uploadedBy, size}`. Never on disk and never public. |
| **invites** | `householdId`, `code` (8 letters and digits without I, L, O, 0, 1; unique; used once), `createdBy`, `expiresAt` (7 days) |
| **householdevents** | `householdId`, `userId`, `actorName` (kept so the log still reads after someone leaves), `type` (`MEMBER_JOINED`/`MEMBER_LEFT`/`PHOTO_CHECKED`), `foodName` (for a photo check), `createdAt` |
| **aiusages** | `userId`, `date` (the user's day), `count` (unique per user and day; the daily AI limit) |
| **usedactiontokens** | `jti` (unique: a notification button token that has carried out its one action), `expiresAt` (when that token expires; a TTL index deletes the record then) |

**The expiry date is calculated in `services/foodService.ts`** from the estimate (see [Automatic expiry pipeline](#automatic-expiry-pipeline)) or the lifespan the person set, when an item is created and whenever its added date or lifespan changes. There's deliberately no Mongoose hook, because hooks don't run on update queries. Any expiry date sent by the client is ignored.

**Indexes:**
- `fooditems {userId, status}` and `{userId, expiryDate}`
- `users.email` (unique)
- `notifications {userId, foodId, type, expiryDate}` (unique, so no duplicate reminders)
- `usagerecords {userId, date, createdAt}`
- `usagerecords {householdId, date, createdAt}`, `shoppingitems {householdId, checked, createdAt}`, `mealplanentries {householdId, date, meal}` (unique), `mealreminderlogs {userId, date, meal}` (unique), `recipeideacaches {householdId, date, mealType}` (unique)
- `invites {code}` (unique), `householdevents {householdId, createdAt}`

**Migrations:** `models/migrations.ts` runs at start-up and is safe to run repeatedly. It:
- converts food dates saved before v2.0 to `YYYY-MM-DD` strings
- gives existing users a household and copies it onto their items (v2.5)
- sets missing `storage` to `FRIDGE` and `openedDate` to null (v2.5)
- copies `lifespanDays` and `storage` into `enteredLifespanDays` and `enteredStorage` where missing (v2.6)
- removes out-of-date indexes

The v2.23 expiry fields need no migration either: an item without `expirySource` reads as `USER`, with the explanation "You set this expected expiry." The v2.7 fields (`reminderDelivery`, `lastDigestDate`, `snoozedUntil`, `pushedAt`) and the v2.17 settings (`alerts`, `mealReminders`) need no migration: their defaults apply when older documents are read. The one v2.17 migration gives existing meal plan entries `meal: "dinner"`, and replaces the old unique index on household and date.

The household ID, storage location and opened date were added **ahead of the later phases**, so shared households, location-based lifespans and the "Opened" action won't need another migration.

**Stored in the browser:** only the login token and basic profile (`localStorage`, through Zustand `persist`), cleared at sign-out, plus the browser's own push subscription when reminders are turned on (removed at sign-out).

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

## How it works

### Expected expiry and urgency

```
expiryDate    = addDays(addedDate, lifespanDays)                  calculated in services/foodService.ts
remainingDays = diffDays(today, expiryDate)                       today = todayInTz(user.timeZone)
```

**Changing the estimate after adding (v2.6):**
- **Opened:** `expiryDate = min(expiryDate, addDays(openedDate, daysLeft))`. It never gets later. The previous lifespan is kept in `lifespanBeforeOpened` so "Mark as not opened" can restore it.
- **Move:** `expiryDate = addDays(today, daysLeft)` for the new location, with the lifespan capped at 365 days.
- Both reschedule the item's pending reminders. Neither changes how the priority engine orders items; it just sorts by the new expected expiry.

| Remaining days | Urgency | Label | Colour | In FridgeStock | Card text |
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
3. Return **`{ items, fridgeStock, summary }`**:
   - `items`: the full sorted list
   - `fridgeStock`: the `APPROACHING_EXPIRY`, `DUE` and `OVERDUE` items, in the same order
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

Every reminder is delivered **in-app** (under the bell). Since v2.7 they can also arrive as **push notifications**; push is an extra layer and in-app delivery never depends on it.

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
- every 5 minutes through node-cron (`*/5 * * * *`; it was hourly before v2.17)

In `GET /foods` it's wrapped so that any reminder failure is only logged: it can never affect the inventory or the FridgeStock list.

**Push (v2.7).** The reminder job runs `pushDue(user)` after `dispatchDue`, for users with at least one registered browser, once the user's chosen hour has arrived in their time zone:

| Mode | What is sent |
|---|---|
| `DIGEST` (default) | Once a day: "FridgeStock: N items to check", listing up to 4 items from the FridgeStock list **in FridgeStock order** ("Bread: expected expiry today", "Chicken: expected expiry in 1 day", "and 2 more"). Opens the FridgeStock screen. With a single item it opens that item and has the Used and Snooze buttons. Nothing is sent when nothing needs attention. |
| `EACH_ITEM` | One notification per reminder delivered that day, with the same text as the in-app reminder, opening that item's Food Details, with **Used** and **Snooze** buttons. |

- **Buttons.** The service worker (`client/public/sw.js`) calls `POST /push/actions` with a narrow **action token** carried in the notification: signed with the server secret, naming one user and one item, and rejected as a login token. Each notification gets its own token (a unique `jti`), valid **24 hours**, that carries out **one action, once**: `pushActionService` records the `jti` in `usedactiontokens` (atomically, by a unique index, so two taps can't both get through; a TTL index drops the record when the token expires) before acting, and gives the token back if the action fails. A meal reminder's token works the same way, for its one meal and day. **Used** closes the item exactly like "Used all" (with a usage record). **Snooze** sets `snoozedUntil` to tomorrow: the item is left out of push reminders until then, then reminded about again (per-item) or back in the summary (digest). It stays in FridgeStock and in-app reminders throughout. If the call fails (expired token, item already closed, offline), Food Details opens instead.
- **Delivery goes through a `PushProvider` interface** (`services/pushProvider.ts`). The Web Push provider uses the `web-push` library with the VAPID keys; a Firebase provider for native apps could be added without touching the notification service.
- **Failures.** 404 or 410 from the push service deletes that subscription. Any other error is logged and the subscription kept. A push failure never changes in-app reminders, and one user's failure doesn't stop others.
- **Wording.** All notification text comes from `server/src/copy.ts`; the service worker has none of its own. The FridgeStock order is read, never changed.

**Feed.** Paginated: pages of up to 50 reminders (`SENT` or `FAILED`), newest first, with the total and the unread count. The Reminders screen has "Load more". `readAt` stays empty until the user opens the Reminders screen, which calls `POST /notifications/read-all`. New ones still show a "New" tag during that visit.

---

### Reminder sounds, quiet hours and meal reminders (v2.17)

**One job, every 5 minutes.** The node-cron job (`*/5 * * * *`) runs `dispatchDue`, then `mealDue(user)`, then `pushDue(user)` for each person with reminders waiting or a registered device. Item reminders and the daily summary still go out at the person's chosen hour; the shorter interval is for meal reminders.

**What sound a reminder gets.** `shared/src/alerts.ts` (pure, used by the server and the app) decides it from the kind of reminder and the person's settings:

| Reminder | Sound | Android channel | Stays on screen (web) |
|---|---|---|---|
| Approaching expiry, daily summary | gentle | `food-soon` (default importance, no vibration) | no |
| Due, overdue | strong | `food-urgent` (high importance, sound and vibration) | yes (`requireInteraction`) |
| Meal reminder | meal | `meal-reminders` (default importance) | no |

Android fixes a channel's sound and vibration, so each combination of the person's switches has a channel: `food-urgent-sound` (strong sound, no vibration), `reminders-vibrate` and `reminders-silent` (no sound, low importance) complete the six. Every push carries `kind`, `channel`, `sound`, `vibrate` (a pattern, empty for none), `requireInteraction` and `silent`; the providers map them:

| Where | Sound | Silent delivery |
|---|---|---|
| Android (FCM data message) | the `channelId`; the app creates the channels at start with `createChannel` | the `reminders-silent` channel |
| iPhone (FCM and APNs) | `aps.sound` = `gentle.caf`, `strong.caf` or `meal.caf`, bundled in the app (under 30 seconds) | no `sound` key, and `interruption-level: passive` |
| Browsers (Web Push) | the system's; the service worker sets a `vibrate` pattern, `requireInteraction` (due, overdue) and the `tag` | `silent: true` |

**Quiet hours** (default 22:00 to 07:00, a start equal to the end means never) use the person's time zone, cross midnight, and follow daylight saving. During them every reminder is delivered silently, but still delivered. The **sound** switch and the **vibration** switch each apply on their own. iPhones can't vibrate per notification, so the vibration switch is for Android and browsers; a browser can't have vibration without its system sound, so with sound off and vibration on it still makes the system sound.

**In-app chime.** With the app open, a push plays the matching sound inside the app (`src/lib/chime.ts`), only after the person has touched the page (browsers refuse earlier), never in quiet hours or with sound off. The service worker and the Android service make the notification itself silent while a page is open, so it isn't heard twice; the iOS config shows a foreground banner without the system sound.

**Meal reminders.** Each person has `mealReminders {breakfast, lunch, dinner}`, each `{enabled, time}`. When a reminder's time arrives (and for up to 30 minutes after, in case the job was late) and none was sent that day for it:

1. `chooseMealContent` (`services/mealContent.ts`, pure and unit-tested) picks what to say:
   1. today's `MealPlanEntry` for that meal;
   2. otherwise, with AI on, the first of **today's cached recipe ideas** for that meal type that hasn't been used for another meal today (titles are compared ignoring case and punctuation);
   3. otherwise the top 3 FridgeStock items, each with its days left in expected-expiry wording ("Bread: expected expiry today");
   4. otherwise nothing: **nothing is sent when FridgeStock is empty and no meal is planned** (even if an old idea is cached).
2. It is sent (silently in quiet hours) and recorded in `mealreminderlogs`, so it goes once a day and "Show recipe" can show what it said.

Recipe ideas are cached per household, per day and per meal (`recipeideacaches`, cleared after 3 days). `POST /ai/recipes` takes an optional `{mealType}` (so breakfast ideas suit breakfast, and it is told which recipes other meals already have) and keeps its answer; when a meal reminder is due and nothing is cached, the AI is asked once for that meal, and if that fails an empty answer is kept so it doesn't ask again that day.

**Buttons.** **Cooked it** opens `/add?leftover=1&from=<meal>`, the leftovers form pre-filled; **Show recipe** opens `/meal/:meal` (`GET /meal-reminders/:meal`: the plan, the recipe with its steps, or the items); **Snooze 30 min** calls `POST /push/actions` with `SNOOZE_MEAL` and the notification's **meal token** (valid a day, naming one person, meal and day, and refused as a login or food token), and the reminder is sent again 30 minutes later with the same tag. On Android the first two open the app and the third calls the server without opening it; on iPhone all three open the app.

**The daily summary and a meal reminder.** If an enabled meal reminder is within 30 minutes of the summary's time, only the meal reminder is sent, with the summary's lines added (a plain message already names the items, so they aren't repeated), and the summary is marked as sent. If that meal reminder can no longer be sent that day, the summary goes as usual. With "one per item" there is no summary to merge.

**The meal plan** (`mealplanentries`) now has a `meal` (breakfast, lunch or dinner, default dinner, one entry per meal per day). Existing plans were all dinners and are migrated. `GET /meal-plan` returns each day's `entry` (the dinner, as before) and `meals`; the Plan screen has a Breakfast / Lunch / Dinner chooser, and the AI draft is for dinners only.

**Wording.** All new text is in `server/src/copy.ts` and `client/src/copy.ts`, uses expected-expiry wording where it names items, and is checked by the banned-phrase tests.

### Design system (v2.18)

Tailwind 4 is configured in CSS: the tokens are in `client/src/index.css` (`@theme`, with the dark values below it).

| Token | Light | Dark |
|---|---|---|
| Background / cards | `#F6F8F5` / `#FFFFFF` | `#0F1C1A` / `#182826` |
| Text / muted text | `#17332A` / `#5B6F66` | `#E8F0EC` / `#A8BAB2` |
| Primary buttons and links | `#1E5F74` | `#7CC3DA` (dark text on it) |
| Not urgent | `#2F7D4F` | `#72A787` |
| Use soon | `#B7791F` | `#C5944C` |
| Expected expiry today | `#D4570E` | `#E08651` |
| Past expected expiry | `#A1253B` | `#CC8995` |

- **Urgency badges** use a light tint of their colour as the background and dark text of the same hue (7:1 contrast), with a different **icon** for each state (check, clock, triangle, octagon) **and** the text label: never colour alone. The strong colour is only for the card's side bar and icons.
- **Type:** Bricolage Grotesque (600, 700) for headings and food names, Figtree (400 to 600) for body text, bundled with `@fontsource` so they work offline in the apps, with system fonts as the fallback. All sizes are in `rem`, so the phone's text-size setting scales everything.
- **Shape and spacing:** Tailwind's 4-point scale; cards 16 px corners (`rounded-card`), buttons 12 px (`rounded-button`), chips fully round; every tap target is at least 48 px (`min-h-12`).
- **Icons:** `lucide-react` throughout. A food with no photo shows an icon for its kind of food (`lib/foodIcon.ts`: carrot, milk, egg, fish, beef, bread and so on) on a soft tile (`FoodThumb`).
- **Shared components** (`components/ui.tsx`, `Urgency.tsx`): `Button`, `Card`, `Chip`, `Field`, `UrgencyBadge`, `BottomSheet` (a real dialog: focus moves in, Tab stays inside, Escape closes, focus returns), `Toast`, `Skeleton`, `Switch`, `EmptyState`.
- **Checks:** `tokens.test.ts` reads the stylesheet and checks every text/background pair for WCAG AA in both themes; the end-to-end `a11y.spec.ts` runs **axe** (WCAG 2.0 and 2.1, A and AA) on every main screen in light and dark mode, at phone and desktop size.
- **Review screenshots:** `npm run design:shots -- <stage>` saves every main screen at 375 px, light and dark, to `docs/design-review/stage-<stage>/` (not committed).

---

## Automatic expiry pipeline

Since v2.23.0 nobody has to type a lifespan. Every item gets an **expected expiry** from `estimateExpiry` in `shared/src/estimate.ts`. It's a pure function, unit-tested in `shared/src/estimate.test.ts`, and the same code runs on the server (what is saved) and in the form (the live preview).

```
 camera / form / receipt / bulk add
          │  name, storage, added date, category?, printed date?
          ▼
 ┌──────────────────────────── estimateExpiry ────────────────────────────┐
 │ 1 PRINTED_DATE     date read off the pack (usable: ≤ 2 years ahead,    │
 │                    ≤ 30 days past)                                     │
 │ 2 LEARNED          this household's usual lifespan for the food and    │
 │                    place, only if shorter than the catalog figure      │
 │ 3 CATALOG          catalog lifespan for the place (opened lifespan     │
 │                    once opened)                                        │
 │ 4 CATEGORY_DEFAULT the category's default for a food not in the catalog│
 │ ── earliest date among 1–4 wins; a tie goes to the higher source ──    │
 │ 5 FALLBACK         3 days, only when none of 1–4 applies               │
 └────────────────────────────────────────────────────────────────────────┘
          │  {expiryDate, source, explanation}
          ▼
 foodService: lifespanDays = expiry − added date; stores expirySource, estimateExplanation,
              printedDate, printedDateType; schedules reminders
```

**Where a printed date comes from.** In order of preference, all optional and always skippable:
1. **On the device:** after a barcode or product photo, the camera screen asks for the date on the pack. `client/src/lib/printedDate.ts` reads the text with the browser's own text detector where there is one, finds date-shaped pieces ("05/11/26", "5 NOV 2026", "11/2026") and names the date from nearby words (USE BY, BEST BEFORE/BBE, EXP).
2. **Typed as printed:** the same parser runs on what the person types.
3. **AI date reader:** with AI on, `POST /parse/date` sends the photo to the **fast** model. The model may only *copy* the text and say what it is called; it has no field for a number of days. The server turns the text into a date with `parsePrintedDate`.

`parsePrintedDate` decides the day/month order of an all-number date from the person's locale (`en-GB` day first, `en-US` month first). A reading that isn't a real date is dropped. If it's still ambiguous, the **earlier** reading is used. A month and year with no day means the last day of that month.

**Rules that keep it honest:**
- **The AI never supplies a lifespan.** Every number of days comes from the catalog (`shared/src/foodReference.ts`), the category defaults, the household's own history, or `FALLBACK_LIFESPAN_DAYS`.
- **Automatic changes only ever shorten.** Opening, moving and Photo Check's *Use today* call `recalculateExpiry`, which returns a new estimate only if it is *earlier* than the current one.
- **The person's own number wins.** *Change estimate* sends a `lifespanDays`; the server stores it with source `USER`. Only `USER` lifespans (`enteredByUser`) are learned from, so estimates never teach the app its own numbers back.
- **Undo restores the source.** "Opened" keeps `sourceBeforeOpened` and `explanationBeforeOpened`, so undoing it puts the earlier estimate and its explanation back.
- **Wording.** Every explanation sentence lives in `shared/data/estimate-copy.json`, read by `shared/src/estimateCopy.ts`, which the wording guard scans like the two `copy.ts` files. Each one talks about an *expected expiry* and never about whether food is fit to eat.
- **Older items** (created before v2.23.0) have no source stored and read as `USER` with "You set this expected expiry."

## AI model routing

All AI calls go through one interface, `AiClient` (`server/src/services/aiClient.ts`), and one service, `aiService.generate`. The service owns the daily allowance (20 per person), the zod check of every answer, the banned-wording check and up to 3 attempts. The provider behind it is a setting:

| | Claude (`anthropic`) | Gemini (`gemini`) |
|---|---|---|
| SDK | `@anthropic-ai/sdk`, JSON-schema structured output | `@google/genai`, JSON structured output |
| Default for | production | development (has a free tier) |
| `fast` tier | `AI_MODEL` (default `claude-sonnet-5-5`) | `GEMINI_MODEL_FAST` (default `gemini-2.5-flash`) |
| `smart` tier | the same model | `GEMINI_MODEL_SMART` (default `gemini-2.5-pro`) |

`AI_PROVIDER` picks the provider. Left empty, it's Gemini in development and Claude in production. AI is on only when the chosen provider's key is set, and **every feature has a path without AI**.

**Which task uses which tier:**

| Task | Endpoint / caller | Tier | Why |
|---|---|---|---|
| Read the date on a pack | `POST /parse/date` | fast | Copying a few characters |
| Read a receipt | `POST /parse/receipt` | fast | Copying lines of text |
| Name a food in a photo, list visible warning signs | `POST /parse/photo` (Photo Check) | smart | Recognition with a strict, problems-only schema |
| Recipe ideas from FridgeStock | `POST /ai/recipes`, meal reminders | smart | Writing |
| Draft a meal plan | `POST /ai/meal-plan` | smart | Writing |

**Rate limits.** `withRateLimitRetry` wraps both providers. An HTTP 429/529 or a quota error gets **one retry after 2 seconds**, then becomes an `AiBusyError`. The service shows "AI is busy, try again later." and **refunds** that request's allowance. The Anthropic SDK's own retries are turned off, so both providers follow one policy.

**Privacy.** Prompts carry only food names, quantities and expected expiry dates, never names or emails. Photos are sent for one request and never stored or logged. Because Google may use free-tier prompts (including photos) to improve its products, the server **prints a warning at startup** when production uses Gemini without `GEMINI_TIER=paid`.

**Choosing a provider.** `npm run eval:ai -w server -- --provider both` runs a local sample set (`server/scripts/ai-eval/samples.json`, format in `samples.example.json`; real samples and photos are git-ignored) through the app's own prompts, schemas and checks. It reports per-task accuracy, valid-answer rate, banned-wording hits, latency, tokens, and cost per 1,000 requests from a `prices.json` you fill in.

---

## Project rules

These rules must never be broken. Each one is enforced in code and checked by an automated test.

| Rule | How it's enforced | Test |
|---|---|---|
| **Never suggest food is fit to eat.** The banned phrases (listed in the wording-guard test) must not appear anywhere. | All expiry wording lives in `client/src/copy.ts` (interface) and `server/src/copy.ts` (reminder messages). | `foodSafetyCopy.test.ts` scans every `.ts`/`.tsx` file in `client/src`, `server/src` and `shared/src`, ignoring case. It fails on any banned phrase, on "safe" in either copy file, or on expiry wording outside the copy files. Playwright also scans every rendered page. |
| **Add Food and FridgeStock show:** *"Expected expiry is an estimate to help you plan. Always check your food before eating it."* | `estimateNote` in `client/src/copy.ts`, shown by the `EstimateNote` component. | Client tests; Playwright journeys 1 and 3 |
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
- **Access control:** the identity comes only from the verified JWT. Every query on shared data (food items, usage records, the shopping list and the meal plan) includes the household's ID, and every query on personal data (reminders, favourites, push subscriptions and AI usage) includes the user's ID. Invite codes are 8 characters from a 31-character alphabet, single-use, expire after a week, and joining is rate-limited like login. Notification buttons use a separate single-item action token that can't sign in. Any `userId` in the body, query string or URL is ignored. Another user's item returns 404.
- **Input:** everything is checked on the server with the shared zod schemas.
- **HTTP:** Helmet headers, CORS limited to `CLIENT_ORIGIN`, a 20 KB request size limit (about 4.5 MB on the receipt route only), `/auth/*` limited to 20 requests per 15 minutes per IP address, and `/push/actions` to 60. AI requests are limited to 20 per user per day.
- **Native apps:** the login token is kept in the iOS Keychain or Android Keystore (not synced to other devices), never in `localStorage`. The API allows the apps' own origins, `capacitor://localhost` and `https://localhost`, next to your web address. A push token belongs to whoever is signed in on the phone: registering it removes it from any other account. Notification buttons use the same short-lived single-item token as the web app's, so they work without the login token; the Android receiver sends it over HTTPS to `PUBLIC_API_URL`.
- **Product photos:** the file type is read from its first bytes (never the name or the type the browser claims) and only JPEG, PNG and WebP are accepted; the picture is decoded and re-encoded (a decompression bomb is refused), which drops EXIF and GPS data and anything hidden in the file. Photos are held in memory while processing, stored only in GridFS, and served only through a signed-in, household-scoped, `private`, `nosniff` route: there is no public folder or address. Uploads are limited to 60 per 15 minutes per IP address. They are deleted 30 days after the item closes and at once with the account.
- **Photo Check:** needs the feature flag and AI. The photo is sent only to the AI for that one request and is never stored or logged. The answer is validated against a strict schema with no way to say a food is fine, every text is checked for banned wording, and the only thing a result can do to an item is make it due today, which the person confirms and the server refuses unless it moves the expected expiry earlier.
- **Scanning:** barcode look-ups go through the server (the browser never contacts the product database), are limited to 60 per 15 minutes per IP address and are timed out after 5 seconds; a receipt photo is sent only to the AI for that one request and is never stored or logged, and every food name read from it is checked for banned wording.
- **AI:** the keys are read only from `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` in `server/.env` (git-ignored), and tests never read them. A free-tier Gemini key in production prints a startup warning. Prompts contain only food names, quantities and expected expiry, never names, emails or other account details. All AI output is validated with zod and checked for banned wording before anyone sees it.
- **Secrets:** read only from environment variables and never committed. The VAPID private key never leaves the server; the end-to-end tests generate a fresh key pair on every run.
