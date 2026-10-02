# Cook First: Perishable Food Cooking Prioritiser

A mobile-first web app that helps a household use perishable food before it goes to waste. You log each item with a lifespan in days. The app works out its **expected expiry**, sorts everything so the most urgent food comes first, and shows a daily **Cook First** list.

> **Food-safety boundary:** *Expected expiry is an estimate to help you plan. Always check your food before eating it.* The app never claims that food is fit to eat.

| | |
|---|---|
| **Status** | MVP complete; post-MVP Phases 1 (faster entry), 2 (realistic estimates), 3 (better reminders), 4 (using the food), 5 (insights) and 6 (dark mode, data export, account deletion, shared households) complete, barcode and receipt scanning, and 7 (Photo Check, behind a feature flag) complete, with a camera screen and product photos, ready-made Android and iOS apps (Capacitor, not yet built on a device), and reminder sounds, quiet hours and meal-time cooking reminders (the sounds are placeholders); voice entry, extra languages and grocery integrations are not built. Not yet deployed. |
| **Version** | 2.22.0 (see the [Changelog](#changelog)) |
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
17. [Deployment: HTTPS staging on real phones](#deployment-https-staging-on-real-phones)
18. [Native apps (Android and iOS)](#native-apps-android-and-ios)
19. [Differences from the design documents](#differences-from-the-design-documents)
20. [Build phases](#build-phases)
21. [Project status](#project-status)
22. [Changelog](#changelog)
23. [Roadmap](#roadmap)
24. [Keeping this README up to date](#keeping-this-readme-up-to-date)

---

## Screenshots

These screenshots are captured automatically by the Playwright test suite.

**Phone (Pixel 7)**

| Dashboard | Cook First | Recording what happened | Add food | Bulk add | Opened | Move | Push reminders | Shopping | Meal plan | Insights | Household | Barcode | Photo Check |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ![Dashboard on a phone](docs/screenshots/mobile-02-dashboard.png) | ![Cook First on a phone](docs/screenshots/mobile-03-cook-first.png) | ![Action sheet on a phone](docs/screenshots/mobile-04-action-sheet.png) | ![Add food on a phone](docs/screenshots/mobile-07-add-food.png) | ![Bulk add on a phone](docs/screenshots/mobile-11-bulk-add.png) | ![Marking milk as opened on a phone](docs/screenshots/mobile-12-opened.png) | ![Moving chicken to the freezer on a phone](docs/screenshots/mobile-13-move.png) | ![Push reminder settings on a phone](docs/screenshots/mobile-14-push-settings.png) | ![Shopping list on a phone](docs/screenshots/mobile-15-shopping.png) | ![Meal plan on a phone](docs/screenshots/mobile-16-plan.png) | ![Insights on a phone](docs/screenshots/mobile-17-insights.png) | ![Household on a phone](docs/screenshots/mobile-20-household.png) | ![Barcode scanning on a phone](docs/screenshots/mobile-21-barcode.png) | ![Photo Check on a phone](docs/screenshots/mobile-23-photo-check.png) |

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
| **Reminders** | In-app under the bell, always. Sent 3 days before expiry, on the expiry day, and the day after. Each type can be turned off in Settings. They're delivered whenever you open the dashboard or the Reminders screen, and by the reminder job (every 5 minutes). They count as read once you open the Reminders screen. |
| **Camera screen** | The **first option on Add Food** is **Use the camera**, with typing it in yourself just below. The camera screen has two modes. **Scan barcode** reads codes **live from the camera** (the browser's `BarcodeDetector` where it has one; otherwise `@zxing/browser`, which also covers Safari on an iPhone) and always offers **typing the number** under the barcode. A code (its check digit is verified) is looked up on the **server** in **Open Food Facts** (free, no key) for the name, first brand and pack size. **Take photo** (only when Photo Check is on) uses a file input with `capture="environment"`, so it opens the camera on a phone, **including an iPhone**, and a file chooser on a computer; the AI names the food and gives its kind. Every find joins a **Scanned so far** list, so a whole shop can be scanned in a row. **One item** fills in Add Food, with the **catalog lifespan suggestion** (your own usual first, then the reference list) for you to confirm; **several** become a **Bulk Add list** to check and put away together (Bulk Add also has **Scan more**). If the camera is **denied or missing**, a short message says so and typing the number still works. Warning signs the AI sees in a photo are shown as a note; acting on them stays with Photo Check on Food Details. |
| **Receipt scanning** | With AI on, **Scan a receipt** on Bulk add takes a photo, scales it to 1600 px in the browser and sends it to Claude, which returns the **food lines only** (name, quantity, unit, price, and the shopping date if clear). They become rows to check: lifespans are suggested from your usual ones, then the reference list, and **nothing is saved until you press Add**. The photo is used for that one request and never stored or logged; each scan counts toward the 20 daily AI requests. |
| **Photo Check** | Behind a feature flag (`PHOTO_CHECK=on`) and only when AI is on; otherwise **no photo controls are shown**. **Check with photo** on Food Details (naming a new food from a photo happens on the camera screen's Take photo). The photo is scaled to 1600 px in the browser and sent to Claude, which returns a **name, category, confidence and visible warning signs** (`MOULD`, `DISCOLOURATION`, `WILTING`, `SLIME`, `BRUISING`, `DAMAGED_PACKAGING`, `SWOLLEN_PACKAGING`, `OTHER`); the answer has **no field for good or normal condition**, and anything outside that shape is refused. A name is only used from **0.6 confidence** (one constant in `shared`); below that you are asked to try again or type it. **Warning signs:** "Visible signs noticed: …. A photo can’t show everything, so check the item yourself before using it." with **Mark as wasted**, **Use today** (asks first; shown only when the expected expiry is later than today, so it can only ever move earlier) and **Dismiss**. **No signs: nothing about condition is shown**, only a neutral "Photo checked". Nothing changes without your confirmation, each check counts toward the 20 daily AI requests, all AI text (including each warning) is checked for banned wording, the photo sent for checking is never stored or logged, and each check is recorded in the household activity log as who checked which food (never the photo or the result). |
| **Product photos** | A photo taken on the camera screen is **kept with the food** once the food is saved (one photo per item; a new one replaces the old). The server **checks the real file type** (JPEG, PNG or WebP only, from the first bytes, not the name), refuses files over **5 MB**, and **re-encodes** the picture with `sharp` to a **WebP of at most 1280 px plus a 320 px thumbnail**, which **removes all EXIF data, including the GPS location**. Both are stored in a MongoDB **GridFS** bucket named `foodPhotos` (never a folder or a public URL) with the household, the food and who uploaded it. They are served only by `GET /api/foods/:id/photo?size=thumb|full`, to a **signed-in member of the household** (404 otherwise), with `Cache-Control: private` and `X-Content-Type-Options: nosniff`. Because an image tag can't send the login token, the app fetches each photo with the token and shows it through an **object URL that is revoked** when its card goes away. **Thumbnails** show on food cards, the **full photo** on Food Details with **Change photo** and **Remove photo**, and **Save product photos** in Settings (on by default) turns keeping them off. Photos are **deleted 30 days after the item is closed** (used, wasted or removed), **at once when you delete your account**, and move with the food when someone joins or leaves a household. Uploads are rate-limited, and **receipt photos are never stored**. |
| **Barcode look-up** | The **server** looks a barcode up in Open Food Facts (a `ProductClient` interface, 5 second time-out, a user agent that says who is asking) and returns the name, first brand and pack size (cl and dl converted to ml). Not found, an unreachable database and a name that would break the wording rules all just ask you to type the name. |
| **Faster entry** | A **reference list of 43 common foods** with suggested lifespans for fridge, freezer and pantry. It suggests as you type, fills in the unit and lifespan, and the user can always change the number. **Favourites** save a food and re-add it with one tap. **Bulk add** handles a whole shopping haul (up to 50 items) in one go. |
| **Where it's kept** | Every item is kept in the **Fridge**, **Freezer** or **Pantry**, and can record an **opened date**. |
| **Realistic estimates** | **Opened** (on the details screen) records the opened date and a days-once-opened value, prefilled from the reference list. The expected expiry becomes the opened date plus those days, but only if that's sooner; opening never makes it later. "Mark as not opened" (or Undo) puts it back. **Move** sends an item to another location and recalculates the expected expiry from today, using that location's suggested lifespan. **Your usual lifespans:** once you've entered the same food in the same location at least twice, Add Food and Bulk add suggest the median of your last 10 (marked ★), ahead of the reference list. |
| **Leftovers** | Add Food has **"These are leftovers"**: it suggests a short lifespan (3 days in the fridge or pantry, 60 in the freezer, from the reference list) and allows **at most 4 days unless frozen**, checked on the server too. Leftovers carry a **Leftovers** tag. "Save leftovers" on a recipe idea opens Add Food with the name filled in. |
| **Shopping list** | Add items (optional quantity and unit), tick them off and clear bought ones. Each item to buy **warns about matching food already at home**, e.g. "Already at home: Chicken (500 g), expected expiry Wed, 30 Sep", linking to that item. Matching is word by word and ignores plurals ("milk" matches "Oat milk"). |
| **Meal plan** | Today and the next six days. Plan a meal for any day with a title and, optionally, the food it uses (chosen from your food in Cook First order). Food that has since been used up is marked "no longer at home". |
| **AI (optional)** | With `ANTHROPIC_API_KEY` set, **Recipe ideas** on Cook First (up to 3, each using at least one Cook First item, ordered by the most urgent item they use) and **Suggest meals for empty days** on the plan (a draft; nothing is saved until you add it). 20 AI requests per user per day. AI reads the Cook First order and never changes it. Every answer is checked with zod and for banned wording (asked for again up to 3 times). |
| **Push reminders** | The app is **installable** (web app manifest, icons, service worker). In Settings, **Turn on reminders** asks for notification permission only when tapped, then registers this browser with the server. Reminders arrive as **one daily summary** of the Cook First list (the default) or **one per item**, at an hour you choose (default 08:00 in your time zone). Per-item notifications have **Used** and **Snooze** buttons; if a button can't be completed, the notification opens Food Details instead. Snooze leaves the item out of push reminders until tomorrow. On an iPhone, Settings explains that the app must be added to the Home Screen first. If push fails or isn't available, reminders still appear in the app. |
| **Insights** | **Used versus wasted** this week with the waste rate and last week for comparison, an eight-week bar chart (with a table for screen readers), the foods you waste most in the last 30 days, and plain tips. An **optional price** on each item gives **money saved and lost** (a partly used item counts for the part used; a removal counts for nothing). Tips talk about habits and amounts bought, never about whether food can be eaten, and the AI is not involved. |
| **Reminder sounds** | Three sounds in `client/assets/sounds`: **gentle** for food approaching its expected expiry and for the daily summary, **strong** for due and overdue, and a **meal** sound. They are **placeholders** (synthetic tones) until you add licensed files. Android has notification channels `food-soon`, `food-urgent` and `meal-reminders` (plus three for the sound, vibration and quiet-hours switches); iPhone plays bundled `.caf` files; browsers use a vibration pattern, keep due and overdue notifications on screen until acted on, and replace repeats by tag. With the app open, the matching chime plays in the app, only after you have touched the page. No full-screen alarms, nothing that rings until dismissed, no iOS critical alerts. |
| **Sound, vibration and quiet hours** | Settings has a **sound** switch, a **vibration** switch and **quiet hours** (22:00 to 07:00 by default, in your time zone). During quiet hours reminders still arrive, silently: no sound and no vibration. |
| **Meal reminders** | Settings has **breakfast, lunch and dinner** cooking reminders, each with a switch (off until you turn it on) and a time (07:30, 12:30, 19:30). At that time the reminder says, in this order: **today's planned meal** for that meal; else, with AI on, **one of today's recipe ideas** for that meal (never the same recipe for two meals in a day); else a plain message naming the top Cook First items with their days left; and nothing if Cook First is empty and no meal is planned. Buttons: **Cooked it** (opens the leftovers form pre-filled), **Show recipe** and **Snooze 30 min**. A meal reminder within 30 minutes of the daily summary replaces it and carries it. The meal plan now has a breakfast, a lunch and a dinner for each day. |
| **Android and iOS apps** | The same app as real **Android and iOS apps**, built with **Capacitor** (`client/android`, `client/ios`, app name **Cook First**). `Capacitor.isNativePlatform()` chooses native versions of four things in `client/src/platform`, so the web app and its tests are unchanged: the **camera** (`@capacitor/camera`: the system camera or photo library), **barcode scanning** (`@capacitor-mlkit/barcode-scanning`: ML Kit's scanner), **push** (`@capacitor/push-notifications` with **Firebase Cloud Messaging**; iPhone goes through Firebase too, with an **APNs key**) and the **login token** (the **iOS Keychain** or **Android Keystore** through `@aparajita/capacitor-secure-storage`, never `localStorage`). Reminders have **Used** and **Snooze** buttons as real notification actions on both. Web Push stays for browsers. See [Native apps](#native-apps-android-and-ios); it has **not been built or run on a device** yet. |
| **Dark mode** | **Appearance** in Settings: System (follows the device, the default), Light or Dark. The choice is kept on this device and applied before the first paint, so there is no flash. Dark colours are the same tokens with dark values (`client/src/index.css`), so urgency is still a colour plus a text label. |
| **Your data** | **Download my data** saves everything the app holds about you (account, food, history, reminders, favourites, shopping list and meal plan) as one JSON file. It never includes the password hash or push keys. **Delete my account** asks for your password again, then permanently deletes the account and every record it owns. |
| **Settings** | Your name and email (read-only), a currency for prices, **Save product photos**, an Appearance choice, Download my data and Delete my account, switches for the three reminder types, push reminders for this device (on/off, daily summary or one per item, and the time), links to Insights and History, and Log out. Logging out turns push off for that account on this device. |
| **Households** | Everyone is in a household, alone until they invite someone. **Invite someone** makes a single-use code (shown as XXXX-XXXX, valid for a week, nothing is emailed) that you send by hand; **Join a household** takes that code. Up to 6 people share the **food, usage history and insights, shopping list and meal plan**, and each member gets reminders for the shared food. **Favourites, reminder settings, currency, AI allowance and push devices stay personal.** Joining brings your own food, history, list and plan into the household (on a day both have a meal planned, the household's stays). **Leave household** takes what you added (and the history of that food) with you and starts a new household; everything else stays. An **activity log** shows who added, used, wasted or removed what, who checked food with a photo, and who joined or left. |
| **Privacy** | You only ever see your own household's food, history, lists and reminders, and your own favourites. Another household's data is indistinguishable from missing (404). |
| **Responsive** | Mobile-first and tested at **375 px** wide, with every button, link and field at least 44 px tall. From 1024 px wide: a sidebar and a two-column layout. Every screen has loading, empty and error states, and any 401 signs you out and returns you to the login page. |

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
│       ├── platform/           the web and native versions of camera, barcode scanning, push and token storage
│       ├── lib/chime.ts        the in-app reminder chime (plays only after a touch, never in quiet hours)
│       ├── test/               frontend tests
│       └── copy.ts             every piece of expiry wording in the interface
├── client/android/             the Android app (Capacitor), with the reminder notification code
├── client/ios/                 the iOS app (Capacitor, CocoaPods), with the Firebase and notification set-up
├── client/capacitor.config.ts  app name, app ID (a placeholder), web folder
├── client/assets/sounds/       the three reminder sounds (placeholders until licensed files are added)
├── e2e/                        Playwright end-to-end tests
├── scripts/check-staging.mjs   checks a deployment from the outside
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

Open http://localhost:5173 and create an account. For a ready-made login with sample food, run `npm run seed -w server` while the API is running (it prints the email and password).

**If `npm run dev:server` won't start:**

| What you see | Why, and what to do |
|---|---|
| `ERR_MODULE_NOT_FOUND: Cannot find package '…\node_modules\@cook-first\shared\index.js'`, or Vite saying it `Cannot find native binding` or `lightningcss.win32-x64-msvc.node` | `node_modules` is damaged, usually after the project folder was moved or copied while a copy was interrupted (a workspace link or a native file ends up empty). Delete `node_modules` (the root one and the ones inside `client`, `server` and `shared`) and run `npm ci`. |
| `DBPathInUse: Unable to create/open the lock file … server\.data\mongod.lock` | Another API is already using the embedded database in `server/.data`. Stop it first (it listens on port 4000, with its database on 27027), or set `MONGO_URI`. |
| `EADDRINUSE` on port 4000 or 5173 | Something else is on that port. Stop it, or change `PORT` / the Vite port (and `CLIENT_ORIGIN`, see above). |

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
| `VAPID_PUBLIC_KEY` | *(empty)* | For push | Web Push public key. The only key the client ever sees (`GET /push/config`). |
| `VAPID_PRIVATE_KEY` | *(empty)* | For push | Web Push private key. Secret; never leaves the server. |
| `VAPID_SUBJECT` | *(empty)* | For push | Contact for push services, a `mailto:` or `https:` URL |

| `ANTHROPIC_API_KEY` | *(empty)* | For AI | Claude API key. AI features are on only when it is set. **Put it in `server/.env` only**, which is git-ignored. |
| `PHOTO_CHECK` | *(empty = off)* | No | Set to `on` to turn on Photo Check. It also needs `ANTHROPIC_API_KEY`; with either missing no photo controls are shown. |
| `ANTHROPIC_BASE_URL` | *(empty = Anthropic)* | No | Read by the Anthropic SDK. Only the end-to-end tests set it, to a local stand-in. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | *(empty)* | For the apps | A Firebase **service account**. Push to the Android and iOS apps is on only when all three are set. The private key is one line with `\n` in place of line breaks. |
| `APNS_BUNDLE_ID` | *(empty)* | No | The iOS app's bundle id (your app ID), sent as the APNs topic. |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | *(empty)* | No | Not read by the server: they record the Apple key you uploaded to the Firebase console (see [Native apps](#native-apps-android-and-ios)). |
| `PUBLIC_API_URL` | *(empty)* | For Android buttons | Where the API is reached from outside (`https://<api>/api`). The **Used** and **Snooze** buttons on Android notifications call it. |
| `PRODUCT_LOOKUP_URL` | *(empty = Open Food Facts)* | No | Where barcodes are looked up. Only the end-to-end tests change it, to a local stand-in. |
| `AI_MODEL` | *(empty = `claude-sonnet-5-5`)* | No | Claude model ID. The default was checked against Anthropic's models overview on 2026-09-30. |

Generate the VAPID key pair once with `npm run vapid:keys -w server`. Push is switched on only when all three VAPID variables are set; without them, reminders stay in-app and Settings says push isn't set up. **Tests never use a real AI key:** the server ignores `ANTHROPIC_API_KEY` when `NODE_ENV` is `test`, and the end-to-end API is started with it empty.

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
| `npm run seed -w server` | With the server running, create a demo account (`demo@cookfirst.local` / `cookfirst-demo`) with 10 priced sample items at every urgency level, plus 5 used or wasted ones so Insights has data. Add `-- --reset` to re-seed. |
| `npm run vapid:keys -w server` | Generate a Web Push (VAPID) key pair for `server/.env` |
| `npm test` | Unit and API tests: shared (45) + server (473) + client (420) |
| `npm run test:e2e` | Playwright end-to-end tests (56), at 375 px and 1440 px |
| `npm run check:staging -- --api <api-url> --client <web-url>` | Check a deployment from the outside (HTTPS, health, CORS, headers, push, install files) |
| `npm run cap:sync -w client` | Build the web app for the apps and copy it into the Android and iOS projects |
| `npm run android -w client` / `npm run ios -w client` | Open the Android project in Android Studio / the iOS project in Xcode (see [Native apps](#native-apps-android-and-ios)) |
| `npm run sounds:sync -w client` / `sounds:check` / `sounds:generate` | Copy the reminder sounds into the Android and iOS projects / check them / write the placeholder tones (see [Native apps](#native-apps-android-and-ios)) |
| `npm run design:shots -- <stage>` | Screenshots of every main screen at 375 px, light and dark, in `docs/design-review/stage-<stage>/` |
| `npm run native:set-app-id -w client -- <id>` | Set the app ID everywhere (`--check` shows where it is set) |
| `npm run build` | Build `shared/dist`, `server/dist` and `client/dist` |

---

## Testing

| Suite | Tools | Tests | What it covers |
|---|---|---|---|
| **Dates, reference list and alerts** (`shared/src/*.test.ts`) | Vitest | 45 | Valid and invalid dates, the hour in a time zone (for push timing), leap years (including 2000 and 2100), today in several time zones, month and year ends, daylight-saving weekends, `addDays`/`diffDays` as inverses, the "Thu, 1 Oct" format; **quiet hours** (across midnight, start included and end not, in the person’s time zone, through daylight saving, off, equal start and end), the **sound, vibration and channel** for every reminder kind and every switch, the 30-minute merge test, the defaults; the reference list (unique names, valid units, 0–365 lifespans, freezer longer than fridge, search) |
| **API and logic** (`server/src/tests`) | Vitest, Supertest, mongodb-memory-server | 107 | `auth`, `foods`, `notifications`, `security` and `priorityEngine` tests: registration and login, tokens, every validation message, limits and units, expiry never accepted from the client, `/use` (whole, partial, 0, negative or too much), `/waste`, `DELETE`, 409 on closed items, `/usage` paging, each reminder scheduling rule (including a zero-day lifespan), the three exact messages, `dispatchDue` on `GET /foods`, a dispatch failure never breaking the inventory or Cook First, `{n}` worked out at send time, delivery, failures and preferences, cross-user isolation, and all the required priority-engine cases |
| **Phase 1** (`phase1.test.ts`) | Vitest, Supertest | 18 | Household, storage and opened-date fields (defaults, validation, editing, backfill of existing data); bulk add (shared date, per-row storage, reminders, the failing row's field path, all-or-nothing, 1–50 limit); favourites (create, duplicate 409, one-tap add, delete, privacy); undo for every action (quantity, status, reminders and usage record restored; stepping back; nothing to undo; 10-minute limit; other users get 404) |
| **Phase 2** (`phase2.test.ts`) | Vitest, Supertest | 16 | Opened: milk shortens to its typical 4 days and reminders move; opening never lengthens the expiry; custom days and past opened dates; 400 when there's no typical value; 409 when already opened or closed; invalid dates; mark as not opened restores the lifespan. Move: chicken to the freezer and back, custom days, the 365-day cap, 400 for no freezer value, the same location or bad days, 404 for another user. Learned lifespans: median of your entries per food and location, at least 2 needed, closed items count, only the last 10, never another user's, backfill |
| **Phase 3** (`phase3.test.ts`) | Vitest, Supertest, a fake `PushProvider` | 30 | Only the VAPID public key is exposed (null when push isn't set up); subscriptions store user, endpoint, keys, browser and last use, re-subscribing updates, https endpoints only, users can only remove their own; delivery settings (daily summary at 08:00 by default, one per item, hour 0–23); the digest waits for the user's hour in their own time zone, goes out once a day, lists the Cook First items in Cook First order ("and N more" after 4), is skipped when nothing needs attention, and never changes the order; one push per item with Used and Snooze and a Food Details link, sent to every browser; 404/410 deletes the subscription, other errors keep it and in-app reminders still arrive; Used closes the item with a usage record; Snooze drops it from today's summary and brings it back tomorrow (and re-pushes it in per-item mode); bad or login tokens rejected, action tokens can't sign in or touch another user's item; the web-push provider's payload, VAPID keys and 404/410 handling |
| **Reminder sounds and meals** (`mealContent.test.ts`, `meals.test.ts`) | Vitest, Supertest, a recording fake push provider, a fake AI | 70 | **Meal content, every branch** (plan, cached idea, plain items, nothing; a plan with no Cook First; an idea built from food that has gone; at most 3 items; recipe titles compared ignoring case and punctuation); **settings** (defaults, partial updates, bad times, equal start and end, unknown fields, login needed); **when** a reminder goes (at the time, not before, once a day, again tomorrow, up to 30 minutes late but not hours, off means off, a device is needed, retried when it reached no device); **time zones** (Kolkata, New York in October and December); **quiet hours** (silent, no sound or vibration, still delivered; each of the sound and vibration switches); **the merge rule** (a meal reminder within 30 minutes carries the summary and replaces it, either side of it; 31 minutes apart they are separate; the summary still goes if the meal reminder can't; no summary with one per item); **no duplicate recipes in a day** (and the next day may reuse one); the AI asked once and kept, never again after a failure, and told the meal and what other meals chose; **Snooze 30 min** (sent again after 30 minutes, once, again, meal token only); **Show recipe**; **push payloads** with the right channel, sound, vibration and stay-on-screen for each reminder type (approaching, due, overdue, summary, meal) with a mocked provider; **the Firebase mapping** (Android channel id and button pages, iPhone `.caf` sound and categories, silent delivery, never a critical alert); meal plans with a meal; all text passes the banned-phrase check |
| **Native push** (`native.test.ts`) | Vitest, Supertest, a fake `FcmMessaging` | 23 | Android and iPhone apps stored by Firebase token with their platform (no secrets returned), browsers still stored as web devices, resubscribing updates, **a phone goes to whoever is signed in on it**, bad platforms and tokens rejected with the shared message, turning off by token only for the signed-in user; `GET /push/config` says whether the apps are set up; sending routes a browser through Web Push and the apps through Firebase, skips a kind with no provider, forgets a gone token and keeps one that failed, and delivers the daily summary with only the app provider set up; the **Firebase provider** sends Android a **data-only** message (so its own service can add buttons) and iPhone a notification with the **category** (and no buttons on the summary), treats unregistered tokens as gone and throws other failures, and never sends to a browser; **CORS** allows the apps' origins and the web app and nobody else; `.env.example` lists the Firebase and APNs settings empty; the service account is read from the environment (`\n` in the private key) |
| **Product photos** (`photos.test.ts`) | Vitest, Supertest, `sharp` fixtures | 34 | Needs sign-in; JPEG, PNG and WebP kept as WebP in two sizes, `photoAt` on the food list, a big photo scaled to 1280 px with a 320 px thumbnail and a small one never enlarged; **rejected:** a text file, PDF, GIF, SVG with a script, HTML or a bare RIFF whatever type they claim, a corrupt JPEG, a missing, empty or wrongly named file, **a file over 5 MB (413)**, a decompression bomb, food that is closed, and photos turned off; the 61st upload in 15 minutes is a 429; **GPS stripped:** a fixture with a real GPS location, camera make and a note ends with no EXIF block, no EXIF chunk and none of those words, orientation applied; served privately with `private` and `nosniff`, the full size by default; **another household gets 404** for every action and nothing changes; no folder serving or disk writes anywhere in the source; **replacement** leaves exactly two files and no orphan chunks; removal; metadata (household, food, uploader); shared households; **automatic deletion** after 30 days (kept at 29 and 30, deleted at 31, for wasted, used and removed food), never for active food, kept after Undo, orphans removed; **account deletion** removes a household's photos at once, and in a shared household the photos of what they added or uploaded but not anyone else's; photos follow food when someone joins or leaves; receipts are never stored |
| **Photo Check** (`photo.test.ts`) | Vitest, Supertest, a fake `AiClient` | 23 | Needs sign-in; off when the flag is off or AI is off (and `photoCheck` in the status says so); bad photos and ids rejected before the AI; the photo reaches the AI with a problems-only prompt; the schema has only name, category, confidence and warning signs; an answer with an extra field, a type that is not a problem, a bad confidence or an empty name is refused, retried and refunded; banned wording in a name or any warning is retried and never returned; counts toward the daily limit; a large photo accepted and never stored anywhere; nothing is added or changed by a check; a photo of an item at home must be one of the household's; the activity log records who checked which food and never the result; no event for a failed check. **Use today:** brings a later expected expiry forward, is a 409 for an item already due or overdue, closed, or in another household, can never move an expiry later (checked over many items), reschedules reminders and leaves the entered lifespan alone |
| **Scanning** (`scanning.test.ts`) | Vitest, Supertest, a fake `ProductClient` and `AiClient` | 25 | Barcode: sign-in needed, bad numbers rejected before any look-up, name/brand/pack size returned, spaces and dashes dropped, cl and dl converted to ml, unknown units left blank, "not found" is a normal answer, banned-wording names hidden, long names cut to 60, a failed look-up is a 503 that leaks nothing; the Open Food Facts client (URL, fields, user agent, time-out, 404 and status 0, bad fields). Receipts: sign-in and AI needed, bad photos rejected before the AI, the photo reaches the AI with the receipt prompt, rounded draft returned and nothing saved, future or invalid dates blanked, counts toward the daily limit, retried then refunded when unusable, banned wording retried, a 3.9 MB photo accepted on this route only and never stored in any collection, over-size refused; bulk add keeps per-row prices |
| **Households** (`household.test.ts`) | Vitest, Supertest | 28 | Everyone starts alone; invite codes (format, one week, limits, cancelling only your own); joining (lower case and dashes, unknown, empty, out-of-date, own, already-shared and full cases; a code works once); your food, list and plan come with you and the household's meal wins on a shared day; members see and act on the same food, history and insights; each member gets reminders, including for food that came with a new member; favourites and currency stay personal; another household sees none of it (404s); the activity log (who did what, newest first, paging); leaving splits food, list, plan and history correctly and drops reminders for food left behind; deleting an account in a shared household removes only that person's food; existing data is given its owner's household at start-up |
| **Phase 6** (`phase6.test.ts`) | Vitest, Supertest | 7 | Export needs sign-in; it returns food, history, favourites, shopping and meal plan as a download, never the password hash, internal ids or another user's data; deleting needs the password (a wrong one is a 400, deletes nothing and keeps you signed in), removes the account and every record it owns while leaving other accounts alone, and lets the same email register again |
| **Phase 5** (`phase5.test.ts`) | Vitest, Supertest | 20 | Optional price (validation, edit, clear); a partly used item is valued by the share used and the rest when wasted; the shown price shrinks with the quantity left and survives a re-save; no value for removals or unpriced items; insights are empty for a new account, count used and wasted, bucket by week, ignore entries older than eight weeks, never include another user, and forget undone actions; most-wasted ranking ignores capital letters; tips (repeat waste, rise, nothing wasted, overdue now, add prices) never use banned wording; currency setting and its validation |
| **Phase 4** (`phase4.test.ts`) | Vitest, Supertest, a fake `AiClient` | 24 | Tests never see a real key; default model `claude-sonnet-5-5`; AI off → 503; the Claude client sends the model, JSON schema, effort and images and rejects refused or cut-off answers; banned wording (the shared seven phrases plus "safe"); recipe ideas get the Cook First list in order, drop unknown codes and ideas without a Cook First item, list ideas by the most urgent item, and never change the order or any item; no AI call when Cook First is empty; retry on banned wording and on invalid answers, 503 after 3 attempts with the request refunded; daily limit of 20 per user, resetting the next day; meal plan week, own-food-only, dates in range, AI draft only for empty days and never saved; shopping warnings for food at home (word and plural matching, closed items ignored), ordering, clearing, privacy, validation; leftover lifespans (at most 4 days unless frozen, including edits and moves) |
| **API contract** (`api.test.ts`) | Vitest, Supertest | 14 | Only the agreed error codes, never a stack trace, 500 is `INTERNAL`, database validation errors are 400, login 401 message, exact register messages, user and food response shapes, priority order and summary, `cook-first` matched before `/:id`, reminders scheduled on create and rescheduled only when dates change, pending reminders deleted on close, old routes removed |
| **Wording guard** (`foodSafetyCopy.test.ts`) | Vitest | 6 | Scans every `.ts`/`.tsx` file in `client/src`, `server/src` and `shared/src`, comments included, for the banned phrases, plus the service worker, app manifest and `index.html`. Fails on the word "safe" in either copy file, or on expiry wording outside the copy files. Checks the required estimate line. |
| **Project rules** (`rules.test.ts`) | Vitest, Supertest | 11 | Every database query carries the user's ID, or the household's ID for shared data; the query-string `userId` is ignored; pure priority engine; bcrypt cost 12; passwords never returned or logged; `.env` ignored; helmet; CORS; rate limit of 20 per 15 minutes |
| **Server structure** (`structure.test.ts`) | Vitest | 12 | The `server/src` folders; thin controllers; only models talk to MongoDB; no `new Date()` in date logic; dates only from `shared`; hourly node-cron job; env variable names and defaults; the threshold of 3 exists only in `config/urgency.ts` (checked across client, server and shared); expiry calculated in the food service with no Mongoose hook |
| **Sounds, quiet hours and meals** (`sounds.test.tsx`, `native-sounds.test.ts`, in the native tests) | Vitest, Testing Library, MSW, file checks | 69 | **The chime** (three different files, not before a touch, the matching sound per kind, never in quiet hours in the person's own time zone, sound switch, a refusing browser, a push from the service worker or the app, stopped on close); **Settings** (defaults, each switch saved, quiet hours off and the times, failure puts it back; meal switches and times); **the meal screen** (recipe, plan, items, Cooked it, none today, a bad meal); Add Food from "Cooked it"; the plan one meal at a time; **native**: the Android channels are created at start (not on iPhone), the push kind is passed on, and the three meal buttons; **the project files**: the six channels agree between JavaScript and Java and cover everything the server can choose, the sound files are where the apps look, under 30 seconds and registered in Xcode, `sounds:sync` (placeholders, licensed files win, once in the project, too long refused), nothing asks for an alarm, a ringing notification or a critical alert, and the service worker's vibration, `requireInteraction`, tag and silent handling |
| **Native platform** (`platform*.test.ts`, `native*.test.ts*`) | Vitest, Testing Library, MSW, fake Capacitor plugins | 78 | **Platform choice** (web in a browser and in tests, iOS or Android in the apps); the web platform is localStorage, the file input and the live camera, unchanged; the **login token in secure storage** (not localStorage, not synced, the app waits for it to be read); the **native camera** (system photo, scaled and upright, cancel is not an error), the **ML Kit scanner** (grocery formats, camera permission, the Android Google module install and its failure), **native push** (permission, registration, token and platform sent to the server, blocked and dismissed, turning off, the listeners started once, **Used and Snooze buttons call the API and fall back to opening the page**); the camera screen, Photo Check, product photos, receipts and Settings push in the app; the app opens a tapped notification's page and refreshes on a push; **native project files**: permissions and the text explaining them, one app ID everywhere, Firebase and notification set-up that matches the server, and `native:set-app-id` |
| **Add food and the first-run guide** (`addfood.test.tsx`, `firstrun.test.tsx`, `bottomsheet.test.tsx`) | Vitest, Testing Library, MSW | 37 | Add food as a dialog with the camera first; the quantity stepper (steps by unit, never to zero, what is saved is what is shown); number keyboards and lifespan chips; Recent (newest first, one of each name, not favourites, at most six, fills the form); who sees the guide (new accounts first, not finished or older accounts, again from Settings); step 1's disclaimer; Next and Back with the step announced and focus on its heading; common foods and favourites added in a request; meal times saved; permission only on "Turn on reminders"; Skip and Start using Cook First save and leave, never trapping if saving fails; the bottom sheet's focus trap, Escape and focus return |
| **Cards and actions** (`cards.test.tsx`, `haptics.test.ts`) | Vitest, Testing Library, MSW | 24 | What a card shows (and no meter, ring or bar); swiping right and left, a short or vertical drag doing nothing, Undo, the visible buttons; optimistic updates and putting back on failure; skeleton loading; pull to refresh (not from a dialog); haptics; the used animation with and without reduced motion; Capacitor Haptics in the apps and nothing in a browser |
| **Home and tab bar** (`home.test.tsx`) | Vitest, Testing Library, MSW | 15 | The Cook first today row (order, badges, days left in words, at most six cards, See all), the current meal's suggestion (planned, or start with the two most urgent; breakfast, lunch and dinner by the hour), the calm state with Plan a meal and Add food, Cooked something, the location chips (priority order kept, empty places, the panel not filtered), the five tabs, and the More sheet (links, closes after a choice, Escape returns focus) |
| **Design tokens** (`tokens.test.ts`) | Vitest | 20 | The colours from the design brief in both themes; WCAG AA contrast (text 4.5:1, badge text 7:1, bars and field outlines 3:1) for every pair the interface uses; card and button corners; the two fonts, bundled and not fetched from a CDN |
| **Wording** (`wording.test.ts`) | Vitest | 13 | Sentence case in every string of the copy file (no "See History", no capitals mid-sentence apart from names, nothing in all capitals, no capitals styling); one name for each action from its button to its toast (Mark as used → Marked as used, and so on); error messages say what happened and what to do, never "something went wrong", and tell apart no connection, signed out, a server problem and anything else, while showing the server's own reason for a mistake; every load error says what could not be loaded |
| **Text size** (`e2e/textsize.spec.ts`) | Playwright | 3 | At 200% text size nothing scrolls sideways, is cut off or runs off the screen on any main screen, in the first-run guide, or in the tab bar |
| **Accessibility** (`e2e/a11y.spec.ts`) | Playwright, axe | 5 | axe (WCAG 2.0 and 2.1, A and AA) finds nothing on any main screen, signed in or out, on the three steps of the first-run guide, or with Add food, Mark as used or More open, in light and dark mode, at phone and desktop size |
| **Frontend** (`client/src/test`) | Vitest, React Testing Library, MSW | 164 | Dashboard order and labels, empty state, signing out when the login expires, Cook First filter, partial use, form validation and preview, the required estimate line, all five remaining-days phrasings, colour always paired with a label, exactly seven units, notes, reminders marked read when the screen opens; the dashboard header, 3-item Cook First with "See all", and empty texts; Add Food defaults, the unit dropdown, the "Add note" link and the preview format; reference suggestions (including following the storage location), storage sent with the item, one-tap favourites, Undo instead of confirmations, bulk add (reference fill, one request, per-row errors); learned lifespans (★ chip, the "You usually set" hint, falling back to the reference list per location); Opened (prefilled days, missing-days message, mark as not opened) and Move (other locations only, per-location suggestion, request body); push reminders (permission asked only on tapping "Turn on reminders", on/off, blocked and dismissed messages, the iPhone Home Screen hint, unsupported browser, no server key, the in-app note, saving mode and time, turning push off at logout with the old token); Phase 4 (recipe ideas hidden when AI is off, shown with the AI note and allowance, the limit message; leftovers prefilled from a recipe, the leftovers box with per-location lifespans and the 4-day check; editing keeps where an item is kept; the shopping warning with expected expiry, add/tick/remove/clear, name required; the meal plan week, planning a meal with your food, and the AI draft saved only on "Add these to my plan"); the browser push layer (iPhone detection, subscribing with the VAPID key and registering the browser, unsubscribing on server and browser, key decoding, browser names); the Reminders error state; plus client structure checks |
| **End-to-end** (`e2e/`) | Playwright in Chrome | 34 | 17 journeys, each run at **375 px phone size** and **desktop size (1440×900)** |

The seventeen end-to-end journeys:

1. **The spec journey:** sign up → add chicken (1-day lifespan) and eggs (8-day) → Cook First shows only the chicken → mark it used → it has disappeared from both the dashboard and Cook First
2. Register → add food → Cook First → mark used → History
3. Partial use, then waste the rest
4. Validation messages and the expected-expiry preview
5. Reminders
6. One user can't see another user's food
7. Reminder settings and log out
8. **Phase 1:** bulk add a haul → waste one and **Undo** it → save a favourite, use it up, and re-add it with one tap
9. **Phase 2:** open milk (7 → 4 days) → move chicken to the freezer (270 days) → add milk again and see "You usually set 7 days" on Add Food
10. **Phase 3:** the manifest and icons are served and the service worker runs → Settings shows "Turn on reminders" with permission still unasked → switch to one per item at 18:00 and reload → tapping asks for permission → an iPhone in a browser tab sees the Home Screen hint instead
11. **Phase 4:** add leftovers (3 days, tagged) → no AI buttons with AI off → shopping list warns that chicken is already at home → tick and clear bought items → plan tomorrow's chicken curry and reload

Every page visited is also checked for banned wording, sideways scrolling, and **tap targets under 44 px**. The end-to-end API runs with a freshly generated VAPID key pair, and with the sign-up rate limit off (the journeys create more than 20 accounts; the limit itself is unit-tested).

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

Test databases live in git-ignored `.test-db-*` folders inside the project, not the system temp folder, and are deleted afterwards. The end-to-end run also starts two local stand-ins, one for Open Food Facts (port 4101) and one for the Anthropic API (port 4102, answering the real SDK with canned JSON), so the AI features, barcode look-ups and Photo Check run end to end with no key and no internet. It uses its own ports (API 4100, web 5174), so it never touches your data.

> **Low disk space on the system drive?** Chrome creates a temporary profile for every Playwright test. If that drive is nearly full, point the temp folder elsewhere for the run. For example, in Git Bash: `TMP="$PWD/.tmp" TEMP="$PWD/.tmp" npm run test:e2e` (`.tmp/` is git-ignored).

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

In `GET /foods` it's wrapped so that any reminder failure is only logged: it can never affect the inventory or the Cook First list.

**Push (v2.7).** The reminder job runs `pushDue(user)` after `dispatchDue`, for users with at least one registered browser, once the user's chosen hour has arrived in their time zone:

| Mode | What is sent |
|---|---|
| `DIGEST` (default) | Once a day: "Cook First: N items to check", listing up to 4 items from the Cook First list **in Cook First order** ("Bread: expected expiry today", "Chicken: expected expiry in 1 day", "and 2 more"). Opens the Cook First screen. With a single item it opens that item and has the Used and Snooze buttons. Nothing is sent when nothing needs attention. |
| `EACH_ITEM` | One notification per reminder delivered that day, with the same text as the in-app reminder, opening that item's Food Details, with **Used** and **Snooze** buttons. |

- **Buttons.** The service worker (`client/public/sw.js`) calls `POST /push/actions` with a narrow **action token** carried in the notification: signed with the server secret, valid 7 days, naming one user and one item, and rejected as a login token. **Used** closes the item exactly like "Used all" (with a usage record). **Snooze** sets `snoozedUntil` to tomorrow: the item is left out of push reminders until then, then reminded about again (per-item) or back in the summary (digest). It stays in Cook First and in-app reminders throughout. If the call fails (expired token, item already closed, offline), Food Details opens instead.
- **Delivery goes through a `PushProvider` interface** (`services/pushProvider.ts`). The Web Push provider uses the `web-push` library with the VAPID keys; a Firebase provider for native apps could be added without touching the notification service.
- **Failures.** 404 or 410 from the push service deletes that subscription. Any other error is logged and the subscription kept. A push failure never changes in-app reminders, and one user's failure doesn't stop others.
- **Wording.** All notification text comes from `server/src/copy.ts`; the service worker has none of its own. The Cook First order is read, never changed.

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
   3. otherwise the top 3 Cook First items, each with its days left in expected-expiry wording ("Bread: expected expiry today");
   4. otherwise nothing: **nothing is sent when Cook First is empty and no meal is planned** (even if an old idea is cached).
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


## Screens

The app is mobile-first and tested at **375 px** wide. Buttons, links and fields are all at least 44 px tall (the Playwright tests check this on every screen). Every screen has loading, empty and error states. Any 401 response clears the saved token and returns to the login page.

| Screen | What it shows |
|---|---|
| **Sign up / Log in** | Email and password (plus name on sign-up). The time zone is captured silently. Errors appear next to each field. On success, the dashboard opens. |
| **Dashboard** | **Header:** your name, a bell with the unread count, and a settings icon. **Summary bar:** past · today · use soon · not urgent. **Cook First:** the top 3 urgent items with "See all" ("Nothing urgent right now." when none). **Full list** in priority order ("Your fridge is empty. Add your first item." when empty). **Add food:** a fixed button. |
| **Add food** | A **These are leftovers** box (short lifespan). One short form: name (focused), quantity (1), unit dropdown (pcs), added date (today, never in the future), lifespan quick picks 1/2/3/5/7/14 plus a number box, and notes behind "Add note". A live preview such as "Expected expiry: Thu, 1 Oct (2 days left)", then the disclaimer. Saving returns to the dashboard with a short confirmation. |
| **Food details** | Every field (including where it's kept and the opened date), plus expected expiry, remaining days and urgency. Active items can be edited, saved as a **favourite**, or marked **Used all**, **Used some** (asks for a quantity), **Wasted** or **Remove**, each with **Undo** afterwards. Closed items are read-only. |
| **Cook First** | With AI on: **Recipe ideas** below the list. Urgent items in priority order: name, quantity, unit, expected expiry, remaining days, urgency and notes, with **Used** (all or some) and **Wasted** buttons, plus the disclaimer. "Nothing needs attention right now." when nothing is urgent. |
| **Bulk add** | Rows of name, quantity, unit, lifespan, where it's kept and an optional price, sharing one added date. With AI on, **Scan a receipt** fills the rows from a photo. Picking a reference food fills in the rest. Errors show on the exact row. |
| **Reminders** | Newest first, 50 at a time with "Load more". Everything is marked read when the screen opens. |
| **Shopping** | Add form (item, optional quantity and unit), **To buy** with at-home warnings, **Bought** with "Clear bought items". |
| **Meal plan** | Seven day cards (Today, Tomorrow, then dates), each with its meal or "Plan a meal"; Edit and Clear; with AI on, "Suggest meals for empty days" and the draft to add or discard. |
| **Navigation** | Phone bottom bar: Home · Cook First · Add food · Shopping · Plan. Settings is the gear in the header; History is linked from Settings. Desktop sidebar: all of them. |
| **Settings** | Name and email (read-only), the three reminder switches, **Push reminders** (Turn on reminders / Turn off on this device, or the reason push isn't available: iPhone Home Screen hint, unsupported browser, blocked permission, or not set up on the server), daily summary or one per item, the time, a link to History, and Log out. |
| **History** | Usage records newest first: food, action, quantity and date, with "Load more". |
| **Insights** | This week (used, wasted, waste rate, last week), Money (only once some entries have a price), Last 8 weeks chart, Wasted most, Tips. Linked from the dashboard, Settings and the desktop sidebar. |
| **Household** | People (with a "You" tag), Invite someone (a code to copy, hidden when the household is full), Open invites (with Cancel), Join a household (only while you are alone), Leave this household (only in a shared one, with a confirmation), and an Activity log with "Load more". Linked from Settings and the desktop sidebar. |

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
| **users** | `householdId` (every user starts in their own household), `name` (1–50 characters), `email` (stored in lowercase, unique), `passwordHash` (bcrypt, never returned), `timeZone` (IANA, default `UTC`), `notificationPreferences {approachingExpiry, due, overdue}` (all default `true`), `reminderDelivery` (`mode`: `DIGEST`/`EACH_ITEM`, default `DIGEST`; `hour`: 0–23, default 8), `currency` (`USD`/`EUR`/`GBP`/`CAD`/`AUD`/`INR`, default `USD`; display only), `savePhotos` (default true), `lastDigestDate`, `alerts` (`sound`, `vibration`, `quietHours {enabled, start, end}`; defaults on, on, on 22:00 to 07:00), `mealReminders` (`breakfast`, `lunch`, `dinner`, each `{enabled, time}`; defaults off at 07:30, 12:30 and 19:30) |
| **fooditems** | `userId` (who added it), `householdId` (the household that owns it; every member sees it), `storage` (`FRIDGE`/`FREEZER`/`PANTRY`, default `FRIDGE`), `openedDate` (`YYYY-MM-DD` or null; not in the future or before `addedDate`), `name` (1–60), `quantity` (> 0), `unit` (`pcs`/`g`/`kg`/`ml`/`l`/`pack`/`bunch`), `addedDate` (`YYYY-MM-DD`, not in the future in the user's time zone), `lifespanDays` (whole number 0–365), `expiryDate` (= `addedDate` + `lifespanDays`), `notes` (optional, ≤ 200), `status` (`ACTIVE`/`USED`/`WASTED`/`REMOVED`, default `ACTIVE`), `closedAt` (set when it stops being active), `snoozedUntil` (`YYYY-MM-DD` or null; set by Snooze on a notification), `leftover` (default false), `photoAt` (when its photo was set, or null; the photo itself is in GridFS), `price` and `priceQuantity` (optional; what that quantity cost, 0–100,000; the API shows `price` for the quantity left), `lifespanBeforeOpened` (null unless opened), `enteredLifespanDays` and `enteredStorage` (what the user typed, used to learn their usual lifespans) |
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

**The expiry date is calculated in `services/foodService.ts`** when an item is created and whenever its added date or lifespan changes. There's deliberately no Mongoose hook, because hooks don't run on update queries. Any expiry date sent by the client is ignored.

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

The v2.7 fields (`reminderDelivery`, `lastDigestDate`, `snoozedUntil`, `pushedAt`) and the v2.17 settings (`alerts`, `mealReminders`) need no migration: their defaults apply when older documents are read. The one v2.17 migration gives existing meal plan entries `meal: "dinner"`, and replaces the old unique index on household and date.

The household ID, storage location and opened date were added **ahead of the later phases**, so shared households, location-based lifespans and the "Opened" action won't need another migration.

**Stored in the browser:** only the login token and basic profile (`localStorage`, through Zustand `persist`), cleared at sign-out, plus the browser's own push subscription when reminders are turned on (removed at sign-out).

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
| POST | `/foods` | `{name, quantity, unit, addedDate, lifespanDays, notes?, storage?, openedDate?, leftover?}` | `201 FoodItem`, with reminders scheduled | 400 |
| POST | `/foods/bulk` | `{addedDate, storage?, items: [{name, quantity, unit, lifespanDays, storage?, notes?}]}` (1–50) | `201 {items}`. All or nothing; errors name the row, e.g. `items.2.name` | 400 |
| POST | `/foods/:id/undo` | | `FoodItem`: the item's most recent action is reversed and its usage record deleted (within 10 minutes) | 404, 409 |
| POST | `/foods/:id/photo` | multipart form, one file in the field `photo` (JPEG, PNG or WebP, up to 5 MB) | the `FoodItem` with `photoAt` set; replaces any earlier photo | 400 wrong type or unreadable, 404, 409 item closed or photos turned off, 413 over 5 MB, 429 |
| GET | `/foods/:id/photo` | `?size=thumb\|full` (default `full`), `v=` (the photo's version, for caching) | the WebP, `Cache-Control: private`, `X-Content-Type-Options: nosniff` | 400, 401, 404 (no photo, or not your household's) |
| DELETE | `/foods/:id/photo` | | `204` | 404 |
| POST | `/foods/:id/use-today` | | `FoodItem` due today (lifespan shortened; reminders rescheduled) | 404, 409 closed, or already due or overdue (it can never move later) |
| POST | `/foods/:id/open` | `{openedDate?, daysLeft?}` (date defaults to today; days default to the reference list) | `FoodItem` with `openedDate` set; expected expiry shortened if sooner; reminders rescheduled | 400 (`daysLeft` needed, bad date), 404, 409 already opened or closed |
| DELETE | `/foods/:id/open` | | `FoodItem` with the lifespan and expiry from before it was opened | 404, 409 not opened |
| POST | `/foods/:id/move` | `{storage, daysLeft?}` (days default to the reference lifespan there) | `FoodItem` with the new `storage`; expected expiry = today + days | 400 (same place, `daysLeft` needed), 404, 409 |
| GET | `/suggestions/lifespans` | | `{items: [{name, storage, unit, days, basedOn}]}`: your median lifespan per food and location | 401 |
| GET | `/foods/:id` | | `FoodItem`, active or closed | 404 if missing or another user's |
| PUT | `/foods/:id` | any food fields | `FoodItem`. Changing `addedDate` or `lifespanDays` recalculates `expiryDate` and reschedules reminders. | 400, 404, 409 |
| POST | `/foods/:id/use` | `{quantity?}` | `{food, usageRecord}`: no quantity (or all of it) → `USED`; less → `PARTIALLY_USED` | 400 for 0, negative or too much; 404; 409 |
| POST | `/foods/:id/waste` | | `{food, usageRecord}`: closed as `WASTED` | 404, 409 |
| DELETE | `/foods/:id` | | `204`: soft-deleted as `REMOVED` | 404, 409 |
| GET | `/household` | | `{members, invites, maxMembers}` | 401 |
| POST | `/household/invites` | | `201 {code, expiresAt, createdBy}` | 409 full or too many open invites |
| DELETE | `/household/invites/:code` | | `204` | 404 |
| POST | `/household/join` | `{code}` | `{members, invites, maxMembers}` | 400 invalid or out-of-date code, or your own, 409 already shared or full |
| POST | `/household/leave` | | `{members, invites, maxMembers}` for your new household | 409 not shared |
| GET | `/household/activity` | `?limit=20&offset=0` | `{items, hasMore}`, newest first | 400 |
| GET | `/account/export` | | The whole account as a JSON download | 401 |
| DELETE | `/account` | `{password}` | `204`; the account and everything it owns are deleted | 400 wrong password, 401 |
| GET | `/insights` | | `{today, thisWeek, lastWeek, last30Days, weeks[8], topWasted[≤5], tips[]}` | 401 |
| GET | `/usage` | `?limit=20&offset=0` (defaults) | `{items, total, counts}`, newest first | 400 |
| GET | `/notifications` | `?limit=50&offset=0` (defaults; max 50) | Sends due reminders, then `{items, total, unread}`: `SENT` or `FAILED`, newest first | 400, 401 |
| POST | `/notifications/read-all` | | `204`: all marked as read | 401 |
| GET | `/favourites` | | `{items}` in name order | 401 |
| POST | `/favourites` | `{name, quantity, unit, lifespanDays, storage?}` | `201 Favourite` | 400, 409 name already a favourite |
| DELETE | `/favourites/:id` | | `204` | 404 |
| POST | `/favourites/:id/add` | | `201 FoodItem` added today | 404 |
| GET | `/notifications/delivery` | | `{mode, hour}` | 401 |
| GET | `/notifications/alerts` | | `{sound, vibration, quietHours: {enabled, start, end}}` | 401 |
| PUT | `/notifications/alerts` | any of `{sound?, vibration?, quietHours?: {enabled?, start?: "HH:mm", end?: "HH:mm"}}` | the settings | 400 (bad time, equal start and end) |
| GET | `/notifications/meals` | | `{breakfast, lunch, dinner}`, each `{enabled, time}` | 401 |
| PUT | `/notifications/meals` | any of `{breakfast?, lunch?, dinner?}`, each `{enabled?, time?: "HH:mm"}` | the settings | 400 |
| PUT | `/notifications/delivery` | `{mode?: "DIGEST" \| "EACH_ITEM", hour?: 0–23}` | `{mode, hour}` | 400 |
| GET | `/push/config` | | `{publicKey, native}`: the VAPID public key (or `null`), and whether push to the apps is set up | 401 |
| POST | `/push/subscriptions` | A browser: `{endpoint (https), keys: {p256dh, auth}, browser?, platform?: 'web'}`. An app: `{platform: 'android' \| 'ios', token (the Firebase device token), browser?}` | `201 {id, platform, browser, createdAt, lastUsedAt}`. An app's token moves to whoever is signed in on that phone. | 400 |
| DELETE | `/push/subscriptions` | `{endpoint}` for a browser, `{token}` for an app | `204` (only your own) | 400 |
| POST | `/push/actions` | `{token, action: "USED" \| "SNOOZE" \| "SNOOZE_MEAL"}`. **No login token:** called by the service worker with the notification's action token. | `204`. USED = "Used all"; SNOOZE = out of push reminders until tomorrow. SNOOZE_MEAL (with a meal reminder's own token) = remind again in 30 minutes. | 400, 401 bad or expired token, 404, 409 already closed |
| GET | `/ai/status` | | `{enabled, photoCheck, dailyLimit, usedToday}` (`photoCheck` is true only when the flag and AI are both on) | 401 |
| POST | `/parse/photo` | `{mediaType, image, foodId?}` (a photo as for receipts; `foodId` when it is of an item at home) | `{name, category, confidence, warningSigns: [{type, description}]}`. Changes nothing. | 400, 404 not your item, 429, 503 off or no usable answer |
| POST | `/ai/recipes` | `{mealType?: "breakfast" \| "lunch" \| "dinner"}` (kept for the day for that meal's reminder) | `{basedOn, recipes: [{title, minutes, uses: [{id, name}], steps}]}`. Empty without asking the AI when Cook First is empty. | 429 daily limit, 503 AI off or no valid answer after 3 attempts |
| GET | `/products/barcode` | `?code=` (8, 12, 13 or 14 digits with a correct check digit; spaces and dashes are dropped) | `{found, barcode, name, brand, quantity, unit}`; `found: false` when it isn't in the database | 400, 429, 503 look-up unavailable |
| POST | `/parse/receipt` | `{mediaType: image/jpeg\|png\|webp, image: base64}` (up to about 3 MB; this is the only route that accepts a large body) | `{purchaseDate, items: [{name, quantity, unit, price}]}`: a draft, nothing saved | 400, 429, 503 AI off or no usable answer |
| POST | `/ai/meal-plan` | | `{days: [{date, title, foods}]}` for empty days only. Not saved. | 429, 503 |
| GET | `/shopping` | | `{items}`: to buy first, then bought; each with `atHome` matches | 401 |
| POST | `/shopping` | `{name, quantity?, unit?}` | `201 ShoppingItem` with `atHome` | 400 |
| PUT | `/shopping/:id` | `{name?, quantity?, unit?, checked?}` | `ShoppingItem` | 400, 404 |
| DELETE | `/shopping/:id` | | `204` | 404 |
| POST | `/shopping/clear-checked` | | `204`: bought items removed | 401 |
| GET | `/meal-plan` | | `{today, days: [{date, entry (the dinner) \| null, meals: {breakfast?, lunch?, dinner?}}]}` for 7 days; each entry is `{meal, title, foods: [{id, name, status}]}` | 401 |
| GET | `/meal-reminders/:meal` | | what today's reminder for that meal said: `{meal, date, content: {source: "plan" \| "recipe" \| "items", …}}` | 401, 404 none sent today |
| PUT | `/meal-plan/:date` | `{meal?: "breakfast" \| "lunch" \| "dinner" (default dinner), title, foodIds?}` | the entry | 400 (date outside the week, not your food) |
| DELETE | `/meal-plan/:date?meal=` | | `204` (the meal, default dinner) | 400 bad meal, 401 |
| PUT | `/notifications/preferences` | `{approachingExpiry?, due?, overdue?}` | preferences; pending reminders of any turned-off type are deleted | 400 |

**Also available** (used by the app):
- `GET /health`
- `PUT /auth/me` (name, time zone, currency, savePhotos, firstRunDone: the first-run guide was seen; new accounts start `false`, older accounts count as done)
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
| 413 | `VALIDATION_ERROR` | A request body over the size limit (20 KB; about 4.5 MB for a receipt or Photo Check photo), or a product photo over 5 MB: "That request is too large." / "That photo is too large (5 MB at most)." |
| 429 | `RATE_LIMITED` | More than 20 requests to `/auth/*` in 15 minutes from one IP address (from the security rules) |
| 503 | `SERVICE_UNAVAILABLE` | The product database can't be reached (barcode look-up); the message tells the person to type the name |
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
- **Access control:** the identity comes only from the verified JWT. Every query on shared data (food items, usage records, the shopping list and the meal plan) includes the household's ID, and every query on personal data (reminders, favourites, push subscriptions and AI usage) includes the user's ID. Invite codes are 8 characters from a 31-character alphabet, single-use, expire after a week, and joining is rate-limited like login. Notification buttons use a separate single-item action token that can't sign in. Any `userId` in the body, query string or URL is ignored. Another user's item returns 404.
- **Input:** everything is checked on the server with the shared zod schemas.
- **HTTP:** Helmet headers, CORS limited to `CLIENT_ORIGIN`, a 20 KB request size limit (about 4.5 MB on the receipt route only), `/auth/*` limited to 20 requests per 15 minutes per IP address, and `/push/actions` to 60. AI requests are limited to 20 per user per day.
- **Native apps:** the login token is kept in the iOS Keychain or Android Keystore (not synced to other devices), never in `localStorage`. The API allows the apps' own origins, `capacitor://localhost` and `https://localhost`, next to your web address. A push token belongs to whoever is signed in on the phone: registering it removes it from any other account. Notification buttons use the same short-lived single-item token as the web app's, so they work without the login token; the Android receiver sends it over HTTPS to `PUBLIC_API_URL`.
- **Product photos:** the file type is read from its first bytes (never the name or the type the browser claims) and only JPEG, PNG and WebP are accepted; the picture is decoded and re-encoded (a decompression bomb is refused), which drops EXIF and GPS data and anything hidden in the file. Photos are held in memory while processing, stored only in GridFS, and served only through a signed-in, household-scoped, `private`, `nosniff` route: there is no public folder or address. Uploads are limited to 60 per 15 minutes per IP address. They are deleted 30 days after the item closes and at once with the account.
- **Photo Check:** needs the feature flag and AI. The photo is sent only to the AI for that one request and is never stored or logged. The answer is validated against a strict schema with no way to say a food is fine, every text is checked for banned wording, and the only thing a result can do to an item is make it due today, which the person confirms and the server refuses unless it moves the expected expiry earlier.
- **Scanning:** barcode look-ups go through the server (the browser never contacts the product database), are limited to 60 per 15 minutes per IP address and are timed out after 5 seconds; a receipt photo is sent only to the AI for that one request and is never stored or logged, and every food name read from it is checked for banned wording.
- **AI:** the Claude API key is read only from `ANTHROPIC_API_KEY` in `server/.env` (git-ignored). Prompts contain only food names, quantities and expected expiry, never names, emails or other account details. All AI output is validated with zod and checked for banned wording before anyone sees it.
- **Secrets:** read only from environment variables and never committed. The VAPID private key never leaves the server; the end-to-end tests generate a fresh key pair on every run.

---

## Deployment: HTTPS staging on real phones

The camera, barcode scanning, push reminders and installing to the Home Screen **only work over HTTPS** (`localhost` is the one exception), so a phone can't test them against your computer. Put a staging copy online:

| Part | Where | Notes |
|---|---|---|
| Web app (`client`) | **Vercel** | Static site; `client/vercel.json` sends every address to the app and never caches the service worker |
| API (`server`) | **Render** (any Node host) | `render.yaml` builds `shared` and `server`, starts `node server/dist/index.js`, checks `/api/health` |
| Database and photos | **MongoDB Atlas** | The free M0 cluster is enough. Product photos are stored in it (GridFS) |

> **Nothing has been deployed yet.** These steps need your own Atlas, Render and Vercel accounts, so they can't be done from this repository.

### 1. MongoDB Atlas
1. Create a free **M0** cluster.
2. **Database Access** → add a user with read and write access, and note its password.
3. **Network Access** → allow `0.0.0.0/0` for staging (Render's free plan has no fixed address). Tighten this for production.
4. **Connect** → *Drivers* → copy the `mongodb+srv://…` string and put a database name before the `?`, for example `…mongodb.net/cook-first-staging?retryWrites=true&w=majority`.

### 2. Generate the push keys (optional, for reminders)
```bash
npm run vapid:keys -w server     # prints a public and a private key
```

### 3. The API on Render
New → **Blueprint** → pick this repository. Then set these in the dashboard (`JWT_SECRET` is generated for you):

| Variable | Value |
|---|---|
| `MONGO_URI` | The Atlas string from step 1 |
| `CLIENT_ORIGIN` | Your Vercel address, **exactly** (for example `https://cook-first.vercel.app`, no trailing slash). Fill it in after step 4. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | The keys from step 2, and `mailto:you@example.com`. Without them reminders stay in the app. |
| `ANTHROPIC_API_KEY`, `PHOTO_CHECK` | Optional: AI features, and `on` for Photo Check |

The free plan **sleeps after about 15 minutes idle**, so the first request afterwards can take 30 to 60 seconds. Open `https://<your-service>.onrender.com/api/health` once before testing on a phone.

### 4. The web app on Vercel
1. **Add New → Project** → import this repository.
2. **Root Directory:** `client`. Leave *Include source files outside of the Root Directory* **on**, because the workspace needs the folders above `client`.
3. **Environment variable:** `VITE_API_URL` = `https://<your-service>.onrender.com/api`.
4. Deploy, then copy the address into `CLIENT_ORIGIN` on Render and let Render redeploy.

### 5. Check it
```bash
npm run check:staging -- --api https://<your-service>.onrender.com --client https://<your-project>.vercel.app
```
It checks HTTPS, the API's health, that CORS allows your web app (and nobody else), the security headers, whether push is set up, and that the web app, manifest, service worker, icons and deep links are served. Fix anything marked FAIL before using a phone. Then create an account on the site. To get sample food on staging, run `API_URL=https://<your-service>.onrender.com/api npm run seed -w server` (it makes the demo account described in [Scripts](#scripts); remove it before sharing the address).

### Install it to the Home Screen
Open the Vercel address on the phone, then:

- **Android (Chrome):** the **⋮** menu → **Install app** (or **Add to Home screen**) → **Install**. It opens in its own window. In Samsung Internet: menu → **Add page to** → **Home screen**.
- **iPhone or iPad (Safari only):** tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**. **Open the app from the new icon**, not from Safari: iPhone only allows push reminders in the installed app, and only on **iOS 16.4 or later**.

Then, on the phone:
1. **Camera:** Add food → **Use the camera**. Allow the camera when asked. If you said no by mistake: Android → Chrome's site settings → Permissions; iPhone → Settings → Safari → Camera (or the app's entry).
2. **Barcode scanning:** point it at a barcode. Chrome on Android uses the phone's own reader; Safari has none, so `@zxing/browser` takes over. Typing the number always works.
3. **Take photo:** uses the phone's camera app (on iPhone too). Needs Photo Check on.
4. **Reminders:** Settings → **Push reminders** → **Turn on reminders** and allow notifications. On Android the notification has **Used** and **Snooze** buttons; iPhone shows the reminder and opens the app when tapped (Safari's push doesn't offer buttons).

| Problem | Likely cause |
|---|---|
| The page loads but nothing works, "Can't reach the server" | `VITE_API_URL` is wrong, or the API is asleep. Open its `/api/health` first. |
| The browser console says CORS | `CLIENT_ORIGIN` on Render isn't exactly the Vercel address. `npm run check:staging` shows it. |
| No **Install app** option on Android | The page isn't https, or you're in a private tab. |
| No reminder permission on iPhone | It must be opened from the Home Screen icon, on iOS 16.4 or later. |
| Photos don't show after a redeploy | They are in Atlas, not on the host. Check the Atlas connection and its 512 MB free limit. |

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request:
- **install → lint → format check → typecheck → unit and API tests → build**, on Node **20.19** (the minimum) and **24**
- then the Playwright end-to-end suite

---

## Native apps (Android and iOS)

The web app also runs as real **Android and iOS apps**, built with [Capacitor](https://capacitorjs.com): the same code in a native shell, with the system's camera, barcode scanner, push notifications and secure storage. `Capacitor.isNativePlatform()` picks the native versions in `client/src/platform`, so the web app and its tests are unchanged.

| | Web app | Android and iOS apps |
|---|---|---|
| Photos | `<input type="file" capture>` | `@capacitor/camera`: the system camera or photo library |
| Barcodes | Live camera view (`BarcodeDetector`, or `@zxing/browser`) | `@capacitor-mlkit/barcode-scanning`: ML Kit's scanner |
| Push | Web Push and a service worker | `@capacitor/push-notifications` through **Firebase Cloud Messaging** (iPhone too, with an **APNs key**) |
| Reminder buttons | Browser notification buttons (not on iPhone) | **Used** and **Snooze** as native notification actions |
| Login token | `localStorage` | **iOS Keychain** / **Android Keystore** (`@aparajita/capacitor-secure-storage`) |

> **Status: written and configured, but not built or run.** The TypeScript, the server and the project files are tested. The Java, Swift and Gradle were **not compiled** and nothing was run on a device, because no Android Studio, Xcode or phone was available. Expect a build error or two on the first build.

### 1. Choose the app ID
`com.example.cookfirst` is a **placeholder**. Choose your own (for example `com.yourcompany.cookfirst`) **before publishing**: once an app is in the Play Store or App Store its ID can't change.
```bash
npm run native:set-app-id -w client -- com.yourcompany.cookfirst
npm run native:set-app-id -w client -- --check     # shows every place it is set, and whether they agree
```
It changes `capacitor.config.ts`, the Android `applicationId` and the iOS bundle identifier. (The Android Java package stays as it is, so no files move.)

### 2. Firebase (push)
1. In the [Firebase console](https://console.firebase.google.com) create a project.
2. **Add an Android app** with your app ID. Download **`google-services.json`** into `client/android/app/`.
3. **Add an iOS app** with the same ID. Download **`GoogleService-Info.plist`** into `client/ios/App/App/`, and in Xcode drag it into the **App** group with *Copy items if needed* and the **App** target ticked.
4. **The APNs key (iPhone):** at [developer.apple.com](https://developer.apple.com/account) → *Certificates, Identifiers & Profiles* → **Keys** → **+**, tick **Apple Push Notifications service (APNs)**, register it, and **download the `.p8` file** (you can only download it once). Note its **Key ID** and your **Team ID**. In Firebase → *Project settings* → *Cloud Messaging* → *Apple app configuration*, **upload the `.p8`** with those two values. Make sure your app's identifier has the **Push Notifications** capability.
5. **The server:** Firebase → *Project settings* → *Service accounts* → **Generate new private key**. From the downloaded file set `FIREBASE_PROJECT_ID` (`project_id`), `FIREBASE_CLIENT_EMAIL` (`client_email`) and `FIREBASE_PRIVATE_KEY` (`private_key`, written on one line with `\n` for the line breaks) on the API host, plus `APNS_BUNDLE_ID` (your app ID) and `PUBLIC_API_URL` (`https://<api>/api`, used by the Android buttons). `APNS_KEY_ID` and `APNS_TEAM_ID` are only a record of what you uploaded; the server doesn't read them. Redeploy, then `npm run check:staging` should say *native push (Firebase) is set up*.

`google-services.json`, `GoogleService-Info.plist` and `client/.env.native` are git-ignored: they belong to your project.

### 3. Point the apps at your API
```bash
cp client/.env.native.example client/.env.native      # then set VITE_API_URL=https://<your-api>/api
```
The apps are built with that address inside them. The API always allows `capacitor://localhost` (iOS) and `https://localhost` (Android) next to your web address.

### 4. Build and run on Android (Android Studio)
You need **Android Studio** (it includes the JDK) and the **Android SDK Platform 36**.
```bash
npm install
npm run cap:sync -w client      # builds the web app for the apps and copies it into both projects
npm run android -w client       # opens client/android in Android Studio
```
1. Wait for **Gradle sync** to finish.
2. Pick a phone (USB debugging on) or an emulator with **Google Play** (push and the barcode scanner need Google Play services), and press **Run ▶**.
3. **Release:** *Build → Generate Signed Bundle / APK → Android App Bundle*. Keep the keystore and its passwords safe, and raise `versionCode` in `client/android/app/build.gradle` for each upload.

The first barcode scan on Android downloads Google's scanner module. Android 13 and later ask for notification permission when you turn reminders on.

### 5. Build and run on iOS (Xcode, on a Mac)
You need a **Mac** with **Xcode**, **CocoaPods** (`brew install cocoapods`), and an **Apple Developer** account to run on a phone or to publish.
```bash
npm install
npm run cap:sync -w client      # also runs "pod install" on a Mac
npm run ios -w client           # opens client/ios/App/App.xcworkspace
```
Always open the **`.xcworkspace`**, never the `.xcodeproj`. Then in Xcode:
1. Select the **App** target → **Signing & Capabilities** → choose your **Team**.
2. Check **Push Notifications** is listed (the `App.entitlements` file is already set up) and **Background Modes → Remote notifications** is ticked.
3. Check `GoogleService-Info.plist` is in the App target (step 2 above).
4. Run on a **real iPhone**: push needs a real device, and so does the barcode scanner. For the App Store: *Product → Archive*; Xcode swaps the development push environment for production.

On iPhone the **Used** and **Snooze** buttons open the app, which then makes the call (the app has to be running to do it). The login token stays in the Keychain, which iOS keeps after an app is deleted, so reinstalling can leave you signed in until you log out.

### Reminder sounds in the apps

The three sounds are in `client/assets/sounds` as **placeholders** (`gentle.placeholder.wav` and `.caf`, and so on): short synthetic tones from `node scripts/sounds.mjs generate`, not licensed recordings. To use your own:

1. Add `gentle.wav`, `strong.wav` and `meal.wav` next to them (`.ogg` and `.mp3` also work for the web and Android). For iPhone add `gentle.caf`, `strong.caf` and `meal.caf`, **each under 30 seconds** (16-bit PCM `.wav` files are converted for you; otherwise on a Mac: `afconvert -f caff -d LEI16 gentle.wav gentle.caf`).
2. `npm run sounds:sync -w client` (`cap:sync` runs it too). It copies them to `android/app/src/main/res/raw/reminder_<sound>.wav` and `ios/App/App/<sound>.caf`, and registers the `.caf` files in the Xcode project (so you don't have to drag them in). A licensed file always wins over its placeholder. `npm run sounds:check -w client` checks all three projects.

The notification channels are created when the app starts, with `@capacitor/push-notifications`: `food-soon`, `food-urgent`, `meal-reminders` and `food-urgent-sound`. The two with no sound, `reminders-vibrate` and `reminders-silent`, are created natively (`MainActivity.java`), because that plugin would give them the default sound. **Android never changes a channel's sound once it exists on a phone**, so after replacing a placeholder, uninstall and reinstall the app on test phones (or change the channel ids in `client/src/platform/native/channels.ts` and `ReminderChannels.java`, which a test keeps in step).

On iPhone the reminder buttons are the notification categories in `AppDelegate.swift` (`FOOD_ITEM`: Used, Snooze; `MEAL_REMINDER`: Cooked it, Show recipe, Snooze 30 min). Nothing asks for critical alerts, so no special Apple entitlement is needed for the sounds.

**Also check on a real phone:** a due reminder uses the strong sound on Android and iPhone; a meal reminder uses the meal sound and shows three buttons; with the app open you hear the chime in the app (after tapping the screen) and the notification is silent; quiet hours deliver silently; turning sound off in Settings stops the sound but not the reminder.

### 6. After changing the web app
`npm run cap:sync -w client` builds and copies it again. There is no live reload.

### What to check on a real phone
1. **Sign in:** close the app completely and open it again: you are still signed in (the token is in secure storage).
2. **Camera screen:** Add food → **Use the camera** → **Scan a barcode** opens the system scanner; **Take photo** opens the camera or photo library. Refuse the camera permission once: you get a short message and can type the number.
3. **Product photos:** save a food from a photo; a thumbnail appears on its card.
4. **Reminders:** Settings → **Turn on reminders**, allow notifications, and check the device appears. Wait for a reminder (or for the 5-minute reminder job). On **Android** the notification has **Used** and **Snooze**; tap one with the app closed. On **iPhone** the buttons appear when you pull the notification down.
5. **Tap a notification** with the app closed: it opens at that food.

### Files
| File | What it is |
|---|---|
| `client/capacitor.config.ts` | App name, app ID (placeholder), web folder, the Android scheme |
| `client/src/platform/` | `web/` and `native/` camera, barcode, push and storage, chosen in `index.ts` |
| `client/android/app/src/main/java/…/ActionMessagingService.java` | Shows reminders with **Used** and **Snooze** (replaces the push plugin's own service) |
| `…/NotificationActionReceiver.java` | Sends a button's action to the API, or opens the item if that fails |
| `…/MainActivity.java` | Opens the page a tapped notification asks for |
| `client/ios/App/App/AppDelegate.swift` | Starts Firebase, hands the Firebase token to the push plugin, registers the notification buttons |
| `client/ios/App/App/Info.plist`, `client/android/app/src/main/AndroidManifest.xml` | The permission text and permissions |
| `client/scripts/set-app-id.mjs` | `npm run native:set-app-id` |

**What the permission boxes say.** iPhone: *"Cook First uses the camera to scan barcodes and to take photos so it can identify your food. Photos are saved privately to your household and are never shared."* and, for the photo library, *"…lets you choose a photo of your food from your library so it can be identified. The photo is saved privately to your household and is never shared."* Android shows its own permission box; the same explanation is in `strings.xml` (`camera_permission_message`) and in the manifest.

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
| Tests: 45 shared + 473 server + 420 client + 56 end-to-end = **994** | ✅ Passing |
| ESLint, Prettier and typecheck on all packages | ✅ Clean |
| All project rules (see [Project rules](#project-rules)) | ✅ Met, each one checked by a test |
| Phone (375 px) and desktop layouts, 44 px tap targets | ✅ Done, checked in screenshots and by tests |
| Docker MongoDB, Render/Vercel config, CI workflow | ✅ Written. CI hasn't run yet because the code isn't on GitHub. |
| Code on GitHub (`rugvailabs/cook_first`) | ⏳ Not pushed yet: the repo is empty |
| Online deployment | ⏳ Configuration and a step-by-step guide are ready ([Deployment](#deployment-https-staging-on-real-phones)); it needs your own Atlas, Render and Vercel accounts, so it has not been deployed |
| Opening on a phone over Wi-Fi | ⏸ Paused: the phone's requests didn't reach the PC |
| Post-MVP Phase 1 (faster entry) | ✅ Done |
| Post-MVP Phase 2 (realistic estimates) | ✅ Done |
| Post-MVP Phase 3 (better reminders) | ✅ Done. Push needs VAPID keys set on the server. |
| Post-MVP Phase 4 (using the food) | ✅ Done. AI features need `ANTHROPIC_API_KEY` in `server/.env`. |
| Post-MVP Phase 5 (insights) | ✅ Done |
| Post-MVP Phase 6 (dark mode, data export, account deletion, shared households) | ✅ Done |
| Post-MVP Phase 6 barcode and receipt scanning | ✅ Done. Receipts need `ANTHROPIC_API_KEY`; barcodes need nothing. |
| Post-MVP Phase 7 (Photo Check) | ✅ Done, behind `PHOTO_CHECK=on` and needing `ANTHROPIC_API_KEY`. Not yet tried against the real API. |
| Android and iOS apps (Capacitor) | ⚠️ Written and configured; **not built or run** (no Android Studio, Xcode or phone was available). The TypeScript, the server and the project files are tested; the Java and Swift are not compiled. See [Native apps](#native-apps-android-and-ios). |
| Reminder sounds, quiet hours and meal-time reminders | ✅ Done and tested with fakes. ⚠️ The sounds are **placeholders**, and the Android and iOS parts have not been heard on a phone. |
| Post-MVP Phase 6 voice entry, languages and grocery integrations | ⏳ Planned (see [Roadmap](#roadmap)) |

---

## Changelog

All notable changes to this project are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org/).

### [Unreleased]
- *Nothing yet.*

### [2.22.0] - 2026-10-03: design and usability, stage 5 (wording and polish) · `c4afcfb`
**Changed**
- **One name for each action, from its button to its toast:** **Mark as used** → "Marked as used", **Mark all as used** and **Mark some as used** → "Marked some as used", **Mark as wasted** → "Marked as wasted", **Mark as opened** → "Marked X as opened", **Move** → "Moved X", **Add food** → "Added X", **Save changes** → "Saved changes", **Save as favourite** → "Saved X as a favourite". The cards, the swipe actions, the sheets and Food Details all use the same words.
- **Sentence case everywhere:** "See history", "Photo check", "Fill in the form"; no all-capitals styling; no symbols standing in for icons (the ★ and ☆ are icons now).
- **Every error says what happened and what to do** (`lib/errors.ts`, `describeError`): no connection ("Check your internet and try again"), signed out ("Sign in again"), the server had a problem ("Try again in a moment"), a limit ("Wait a minute"), or the server's own reason when it explains a mistake in what was typed. They replace "Something went wrong" and "Couldn’t save that" everywhere (saving, adding, undoing, moving, the meal plan, the shopping list, settings, loading food).
- **Every empty state has a short explanation and a button:** Cook First (Plan a meal, Add food), History (Go to Home), Reminders (Choose reminder settings), Shopping (Add an item, which moves to the field), the household activity (Add food); and every "couldn’t load" screen has **Try again** (`LoadError`), as does Food Details, which also offers Go to Home.
- **Text size:** nothing is cut off or runs off the screen at 200% text size on any main screen, the first-run guide or the tab bar (long names wrap instead of being truncated, badges wrap, a card's picture stacks above its text when there isn't room, the guide's buttons wrap). The tab labels follow the text size up to 125%, because a tab bar has no room for more.
- Photo thumbnails are a fixed size so the words get the room.

**Added**
- **A "Skip to main content" link** as the first Tab stop on every signed-in screen; the main area is the target. Each screen has one heading and one main area.
- Tests: `wording.test.ts` (13: sentence case across every string in the copy file, no all-capitals styling, button-to-toast names, the error messages), empty states and load errors, and end-to-end: **200% text size** on every main screen, the tab bar and the guide (`textsize.spec.ts`), a **keyboard-only** journey (skip link, open a card, mark as used, the Add food dialog's focus), and **axe with a dialog open** (Add food, Mark as used, More) in light and dark.


### [2.21.0] - 2026-10-03: design and usability, stage 4 (adding food and first run) · `d21d5af`
**Added**
- **Add food is a bottom sheet** (on a phone it slides up; on a larger screen it is a centred dialog). It is a real dialog: focus starts on the food name, Tab stays inside, Escape or the backdrop closes it and focus goes back. The **camera is first**, then favourites, then **Recent** (the foods you added most recently, one of each, without your favourites): tapping one fills the form from that food (amount, unit, lifespan, place) for you to check and save.
- **A + / - stepper for quantity** (a half for kilos and litres, 50 for grams and millilitres, 1 for the rest), with the number still typeable. Quantity and price open a **decimal keyboard** and lifespan a **numeric** one; the lifespan **quick-pick chips** (1, 2, 3, 5, 7 and 14 days) stay.
- **A three-step first-run guide** (`/welcome`), shown once to a new account and available again from **Settings → How Cook First works**: (1) what "expected expiry" means, with the disclaimer in a note; (2) add the first food with the **camera**, your **favourites**, or a tap on **common foods** (added to the fridge with their usual unit and lifespan); (3) choose **meal times** and turn on **reminders**. The phone's permission for notifications is asked **only** when "Turn on reminders" is tapped here or in Settings (a test checks no step asks earlier). Skip is on every step, finishing or skipping saves that it has been seen, and a failure to save never traps anyone in it.
- `firstRunDone` on the account (`PUT /auth/me`): new accounts start with `false`; accounts made before the guide count as done.
- Shared pieces: `MealTimes` (the meal-time switches, now in Settings and the guide) and `usePushReminders` (the push on/off logic, now in Settings and the guide).
- Tests: 5 server, 13 for Add food, 19 for the guide, 5 for the bottom sheet, and two end-to-end journeys (the guide and the sheet), and axe on every step of the guide in both themes.

**Changed**
- The outline of every field, select and control uses the stronger `field` colour (3:1), not the faint hairline.
- New accounts see the guide before Home; the end-to-end sign-up helpers skip it.


### [2.20.0] - 2026-10-03: design and usability, stage 3 (cards and actions) · `1e98865`
**Added**
- **Swipe a food card right for "Used" and left for "Wasted"** (`SwipeActions`), with the existing **Undo** toast. The actions are drawn underneath while you drag, each with an icon and a word; a short or mostly vertical drag does nothing (the page still scrolls), and a drag that ends on the card doesn't also open it. The cards keep their visible **Used** and **Wasted** buttons, and **Food Details** keeps its buttons, so swiping is never required.
- **Optimistic updates:** marking food as used or wasted (or using part of it) changes the lists at once; if the server refuses, the card comes back with a message saying what happened and what to do.
- **The one deliberate animation:** when an item is marked as used, its card shows a short check mark and closes up (`card-collapse`, 380 ms). It is skipped when the phone asks for reduced motion.
- **Skeleton loading** (`SkeletonList`) replaces every spinner, announced once to a screen reader as "Loading".
- **Pull to refresh** (`PullToRefresh`): pull down from the top of any signed-in screen to reload the food and reminders.
- **Haptics:** `@capacitor/haptics` in the apps (a success tap for a completed action, a warning tap for wasted); a browser does nothing. A new `platform.haptics`.
- Tests: 20 for the cards (`cards.test.tsx`: what a card shows and that it has no meter, ring or bar; swiping right and left, short and vertical drags, Undo, the buttons; optimistic updates and putting back on failure; skeletons; pull to refresh; haptics; the animation with and without reduced motion), 4 for haptics, and a swipe journey end to end.

**Changed**
- A card shows the time left only as words and the urgency badge. There is no freshness meter, filling ring or emptying bar anywhere (a test checks).
- The food name on a card, and `Spinner`, are replaced as above.


### [2.19.0] - 2026-10-03: design and usability, stage 2 (navigation and home) · `227e87e`
**Added**
- **A new bottom tab bar** on phones: **Home**, **Cook First** (with its count), a large central **Add food** button, **Shopping**, and **More**. More opens a sheet with **Meal plan**, **Settings**, **History**, **Insights** and **Household** (Meal plan joins the four you asked for, because it no longer has a tab and would otherwise be hard to reach). The sidebar on desktop is unchanged.
- **Home now starts with a "Cook first today" panel:** the most urgent food (up to six) as large cards in a row you scroll sideways, each with its photo or category icon, name, days left in words and the urgency badge; below it the **current meal's suggestion** (today's planned breakfast, lunch or dinner, otherwise "start with" the two most urgent items; the meal is chosen by the time of day in your time zone) and a **Cooked something** button that opens the leftovers form. When nothing is urgent the panel is a calm message with **Plan a meal** and **Add food**.
- **Location chips** (**All**, **Fridge**, **Freezer**, **Pantry**) filter the full inventory below the panel, which stays in priority order. The panel is not filtered.
- Tests: 15 for Home and the tab bar (`home.test.tsx`).

**Changed**
- The four count tiles at the top of Home (past, today, use soon, not urgent) are gone, so the panel is first as asked; the same counts are in the Cook First badge and on Insights.
- On phones the meal plan is reached through More.


### [2.18.0] - 2026-10-03: design and usability, stage 1 (design system) · `79054fc`
**Added**
- **Design tokens** in `client/src/index.css`: the light and dark palettes and urgency colours from the design brief, 16 px card and 12 px button corners, and the type scale (see [Design system](#design-system-v218)).
- **Fonts:** Bricolage Grotesque (600, 700) for headings and food names and Figtree (400 to 600) for body text, installed with `@fontsource` (bundled, so they work offline in the apps).
- **Urgency badges** with a tinted background, dark text of the same hue, an icon for each state and the label.
- **Category icons** (`lib/foodIcon.ts`, `FoodThumb`) as the picture for food without a photo.
- **Shared components:** `Card`, `BottomSheet` (with a focus trap and focus return), `Toast`, `Skeleton` and `SkeletonList`, joining `Button`, `Chip` and `UrgencyBadge`; the existing sheets (Used, Opened, Move) and the card containers now use them.
- **lucide-react** icons replace the hand-drawn SVGs and symbols in the navigation, headers, lists and buttons.
- **Tests:** `tokens.test.ts` (20: the brief's colours and WCAG AA contrast of every pair in both themes) and an end-to-end **axe** check (`a11y.spec.ts`) of every main screen in both themes at phone and desktop size. There were no axe checks before this; they are new.
- **`npm run design:shots -- <stage>`** captures every main screen at 375 px in light and dark mode for review.

**Changed**
- Every tap target is at least 48 px (was 44); the end-to-end tap-target check is 48 px. Pixel font sizes became `rem`.
- The food name on a card is a heading, so tests and screen readers find it by role.
- Text on brand-coloured backgrounds is full strength (translucent text failed contrast).


`### [2.17.0] - 2026-10-03: reminder sounds and meal-time cooking reminders · `fa453f1`
`**Added**
`- **Three reminder sounds** in `client/assets/sounds` (gentle, strong, meal), as clearly named **placeholders** (`<sound>.placeholder.wav` and `.caf`, synthetic tones) until licensed files are added; a licensed `<sound>.wav` or `.caf` wins over its placeholder. `client/scripts/sounds.mjs` (`sounds:generate`, `sounds:sync`, `sounds:check`; `cap:sync` runs `sounds:sync`) copies them to `android/.../res/raw/reminder_<sound>.*` and `ios/App/App/<sound>.caf`, converts a 16-bit PCM WAV to CAF, refuses an iOS sound of 30 seconds or more, and registers the `.caf` files in the Xcode project.
`- **Android notification channels**, created at app start with `@capacitor/push-notifications` `createChannel`: `food-soon` (default importance, gentle sound), `food-urgent` (high importance, strong sound and vibration), `meal-reminders` (default importance, meal sound), and `food-urgent-sound`. `reminders-vibrate` and `reminders-silent` have no sound and are made natively (that plugin can't), because Android fixes sound and vibration per channel and the sound, vibration and quiet-hours switches need one for each combination. `ReminderChannels.java` makes any that is missing when a reminder arrives, and a test keeps it in step with the JavaScript table.
`- **Every push says how it should sound:** `kind`, `channel`, `sound`, `vibrate`, `requireInteraction` and `silent` (`shared/src/alerts.ts`, pure). Android gets the `channelId`; iPhone gets `aps.sound` = `<sound>.caf` (and no sound key and `interruption-level: passive` when silent); Web Push gets a vibration pattern, `requireInteraction` for due and overdue, a `tag` so a repeat replaces the earlier one, and `silent`.
`- **The in-app chime** (`src/lib/chime.ts`): with the app open, a push plays the matching sound, only after the person has touched the page, never in quiet hours or with sound off. The service worker and the Android service make the notification silent while the app is open, so it isn't heard twice.
`- **Settings: Sounds and quiet hours.** A sound switch, a vibration switch and quiet hours (on, 22:00 to 07:00 by default, in the person's time zone, crossing midnight and following daylight saving). In quiet hours every reminder arrives silently. `GET` and `PUT /notifications/alerts`.
`- **Settings: Meal reminders.** Breakfast, lunch and dinner, each with a switch (off by default) and a time (07:30, 12:30, 19:30). `GET` and `PUT /notifications/meals`.
`- **Meal-time cooking reminders** (`services/mealReminderService.ts`). The job now runs **every 5 minutes** (`*/5 * * * *`). At each meal's time (and up to 30 minutes after, if the job was late) a reminder is sent once a day, chosen by the pure, unit-tested `chooseMealContent`: today's planned meal for that meal; else, with AI on, one of today's cached recipe ideas for that meal type (never one already used for another meal that day); else a plain message naming the top Cook First items with their days left; else nothing when Cook First is empty and no meal is planned. Buttons: **Cooked it** (the leftovers form, pre-filled), **Show recipe** and **Snooze 30 min** (sent again 30 minutes later; a `SNOOZE_MEAL` action with its own one-day meal token).
`- **A meal reminder within 30 minutes of the daily summary replaces it** and carries its lines; the summary is marked sent. If that meal reminder can no longer be sent, the summary goes as usual.
`- **Recipe ideas for a meal:** `POST /ai/recipes` takes an optional `{mealType}`, so breakfast ideas suit breakfast and it is told which recipes other meals already have. Ideas for a meal are **cached** per household per day (`recipeideacaches`); a meal reminder asks the AI once when nothing is cached, and keeps an empty answer on failure so it doesn't ask again.
`- **Meal plans have a meal.** `mealplanentries.meal` (breakfast, lunch or dinner, default dinner; one entry per meal per day, migrated). `PUT /meal-plan/:date` takes `meal`, `DELETE` takes `?meal=`, and `GET /meal-plan` adds `meals` to each day (`entry` is still the dinner). The Plan screen has a Breakfast / Lunch / Dinner chooser; the AI draft stays for dinners.
`- **"Show recipe" screen** (`/meal/:meal`, `GET /meal-reminders/:meal`) shows what today's reminder said: the plan, the recipe with its steps, or the items. New collections `mealreminderlogs` (once a day, snooze, what was said) and `recipeideacaches`; both are cleared on account deletion.
`- **Tests:** 15 shared (quiet hours across midnight, time zones and daylight saving; sounds and channels for every kind and switch; the 30-minute merge), 70 server (every branch of the meal content, time zones, quiet hours, the merge rule, no duplicate recipes, push payloads with a mocked provider, the Firebase mapping), 69 client (the chime and when it may play, Settings, the meal screen, the plan, native channels and buttons, and the native project files and sound scripts), and 1 end-to-end journey.
`
`**Changed**
`- The reminder job is every 5 minutes instead of hourly. Item reminders and the daily summary are unchanged: they go once the person's chosen hour has arrived.
`- \`PushPayload\` has the six new fields and its buttons may carry a \`url\`; \`PUSH_ACTIONS\` is unchanged and \`SNOOZE_MEAL\` is accepted by \`POST /push/actions\`. The service worker opens a button's page, or calls the API for the others. The native push plugin no longer plays a sound for a foreground push (the app's chime does).
`- \`itemPush\`, \`digestPush\` and the new \`mealPush\` moved to \`services/pushPayloads.ts\`; the user's alert and meal settings read through \`services/userSettings.ts\` (older accounts get the defaults).
`
`**Not in this release**
`- **Not built or run on a device:** the Java, Swift and Gradle are still uncompiled, so the channels, sounds and buttons haven't been heard on an Android or iOS phone.
`- **The sounds are placeholders:** no licensed recordings were supplied.
`- No full-screen alarms, notifications that ring until dismissed, or iOS critical alerts: by design.
`- Meal reminders are push only (they don't appear under the bell).

### [2.16.0] - 2026-10-02: Android and iOS apps (Capacitor) · `87a7f5e`
**Added**
- **Capacitor** in the client workspace, with an Android and an iOS project (`client/android`, `client/ios`; iOS uses CocoaPods because the ML Kit scanner and Firebase need it). App name **Cook First**; the app ID is the placeholder `com.example.cookfirst` in one place each, and `npm run native:set-app-id -w client -- <id>` changes every place (it keeps the Android Java package, so no files move).
- **`client/src/platform`:** web and native implementations of the **camera**, **barcode scanning**, **push** and **token storage**, chosen once with `Capacitor.isNativePlatform()`. Native: `@capacitor/camera` for photos, `@capacitor-mlkit/barcode-scanning`, `@capacitor/push-notifications`, and `@aparajita/capacitor-secure-storage` (iOS Keychain, Android Keystore) for the login token instead of `localStorage`. The plugins load on demand, so a browser never downloads them. The web implementations wrap exactly what the app did before.
- **Server:** push to the apps through **firebase-admin** behind the existing `PushProvider` interface (`fcmProvider.ts`), next to Web Push. **Each subscription stores its platform** (`web`, `android`, `ios`); an app is registered by its Firebase token and a phone belongs to whoever is signed in on it. Android gets data-only messages (so its own service can add buttons) and iOS notification messages with a category, through **FCM with an APNs key**. `GET /push/config` says whether the apps are set up.
- **Notification buttons:** **Used** and **Snooze** as native actions: Android (`ActionMessagingService.java` and `NotificationActionReceiver.java` call `POST /push/actions` without opening the app, or open the item if that fails) and iOS (a notification category registered in `AppDelegate.swift`; the tap comes back to the web app, which calls the API).
- **CORS** always allows `capacitor://localhost` and `https://localhost`, next to `CLIENT_ORIGIN`.
- **Permissions:** the iOS `Info.plist` explains the camera and photo library ("…so it can identify your food. Photos are saved privately to your household…"), and the Android manifest asks for the camera (not required) and notifications, with the same wording in `strings.xml`.
- `.env.example`: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` and `PUBLIC_API_URL`, all empty. `client/.env.native.example` for the API address the apps are built with. Firebase files and `.env.native` are git-ignored.
- **Docs:** a Native apps guide: Firebase and APNs set-up, **Android Studio** and **Xcode** build steps, what to check on a phone.
- **Tests:** 23 server, 78 client (platform choice, secure storage, the native camera, scanner and push, the screens in the app, and the native project files and the app-ID script).

**Changed**
- The auth store uses `createJSONStorage(() => platform.storage)` and the app waits for the saved login to be read (instant in a browser). `PushReminders`, `CameraScreen`, Photo Check, Food Details and Bulk Add go through the platform.
- `PushDevice` has a `platform`; `PushTarget` is a web or an app target; `pushProvider()` is the Web Push provider and `nativePushProvider()` the Firebase one. A reminder is pushed when either is set up.
- `unsubscribePush` takes an endpoint or a token; `POST /push/actions` has an API-client function.
- ESLint and Prettier skip `client/android` and `client/ios`.

**Not in this release**
- **Not built or run:** the Java, Swift and Gradle were not compiled and nothing was run on an Android or iOS device (no Android Studio, Xcode or phone was available). Expect to fix a build error or two on the first build.
- Real app icons and splash screens (Capacitor's defaults are used), live reload, and background notification actions on iOS (the buttons open the app).
**Added**
- **HTTPS staging guide** for testing the camera, barcode scanning, push and installing on real phones: MongoDB Atlas, Render and Vercel, with the variables to set, and how to install to the **Home Screen on Android (Chrome, Samsung Internet) and iPhone (Safari, opened from the icon, iOS 16.4 or later)**, plus a troubleshooting table. Nothing has been deployed: that needs your own accounts.
- `npm run check:staging -- --api <url> --client <url>` (`scripts/check-staging.mjs`): checks a deployment from the outside without a login: HTTPS, health, CORS (your web app allowed, other sites refused), security headers, push set-up, and that the manifest, service worker, icons and deep links are served.
- `render.yaml` lists `PUBLIC_API_URL` and `PHOTO_CHECK`; `client/vercel.json` never caches the service worker or manifest, so updates reach phones.

**Checked**
- A production build (`npm run build`) starts with `NODE_ENV=production`, serves `/api/health`, allows only the configured `CLIENT_ORIGIN` in CORS and sends HSTS and `nosniff`; `@zxing/browser` is a separate chunk that loads only when needed.

### [2.14.0] - 2026-10-02: camera screen and product photos · `a3b3759`
**Added**
- **Camera screen** (first option on Add Food, with typing it in yourself below): **Scan barcode** reads codes live (the browser's `BarcodeDetector`, with `@zxing/browser` as the fallback, for example on an iPhone) and always offers typing the number; **Take photo** (when Photo Check is on) uses `<input type="file" accept="image/*" capture="environment">`, so it works on an iPhone and is a file chooser on a computer, and names the food through `POST /parse/photo`. Finds join a **Scanned so far** list: one fills in Add Food with the catalog lifespan suggestion; several become a **Bulk Add** list (and Bulk Add has **Scan more**). A denied or missing camera shows a short message and falls back to typing.
- **Product photos** (`POST|GET|DELETE /foods/:id/photo`): uploaded after the food is saved with `multer` (memory storage, 5 MB limit); the real file type is checked (JPEG, PNG, WebP), then `sharp` re-encodes a WebP of at most 1280 px and a 320 px thumbnail, which removes EXIF data including GPS. Stored in a GridFS bucket `foodPhotos` (household, food and uploader in the metadata), one per item. Served only to a signed-in member of the household (404 otherwise), with `Cache-Control: private` and `X-Content-Type-Options: nosniff`; the app fetches photos with the login token and shows them through object URLs that are revoked on unmount.
- **Thumbnails** on food cards, the **full photo** on Food Details with **Change photo** and **Remove photo**, and a **Save product photos** setting (on by default; `savePhotos` on the user).
- **Deletion:** photos are removed 30 days after their item is closed (a daily job), at once when the account is deleted (and with a household of one), and they move with food when someone joins or leaves a household. Uploads are rate-limited (60 per 15 minutes per IP address). Receipt photos are never stored.
- **Tests:** 34 server, 36 client in a new camera file (replacing the old Add Food scan tests), the barcode and Photo Check journeys rewritten for the camera screen, and a product-photos journey (phone and desktop).

**Changed**
- The separate **Scan a barcode** and **Identify from a photo** buttons on Add Food are gone: both are modes of the camera screen. Typing a barcode number now lives there. Photo Check is now only on Food Details.
- `FoodItem` has `photoAt` and `User` has `savePhotos`. `photoForUpload` also returns the picture, to keep with the food.
- A lost photo no longer hides behind the "Added" message: the toast says the food was saved but the photo wasn't kept.

**Fixed**
- Bulk Add's receipt request would also have sent the new picture field; it now sends only the picture's text, and the receipt photo is still never kept.

**Not in this release**
- Voice entry, other languages and grocery integrations. Not tried with a real phone camera or the real Anthropic API.
**Changed**
- README: a troubleshooting table for `npm run dev:server` (a damaged `node_modules`, the embedded database already in use, a busy port), and a pointer to the seed script from "Start the app". The server's watch mode was checked after a clean `npm ci`: it starts, and a changed file restarts the API and its database. An earlier crash with `ERR_MODULE_NOT_FOUND` could not be reproduced afterwards, from Git Bash, PowerShell or `cmd`; it most likely came from `node_modules` damaged by an interrupted folder move.

### [2.13.0] - 2026-10-02: Phase 7 (Photo Check) · `1c386de`
**Added**
- **Photo Check** (`POST /parse/photo`), behind the `PHOTO_CHECK=on` flag and only when AI is on (`photoCheck` in `GET /ai/status`). **Identify from a photo** on Add Food pre-fills the name (and, for a known food, its usual lifespan and place) when the AI is at least 0.6 sure; **Check with photo** on Food Details shows visible warning signs with **Mark as wasted**, **Use today** and **Dismiss**. No warning signs means nothing about condition is shown. See the [specification](#phase-7-photo-check-specification).
- **Strict AI answer:** name, category, confidence and warning signs only; anything else (an extra field, a type that isn't a problem) is refused, retried and refunded. Every text, including each warning, goes through the banned-wording retry.
- **Use today** (`POST /foods/:id/use-today`): brings a later expected expiry forward to today after the person confirms. It refuses an item already due or overdue, so it can never move an expiry later; the entered lifespan is left alone so your usual lifespans aren't learned from it.
- **Activity log:** a `PHOTO_CHECKED` event (who checked which food; never the photo or the result).
- `PHOTO_CONFIDENCE_MIN` (0.6) and `WARNING_SIGN_TYPES` in `shared`; `config/features.ts` for the flag.
- **Stand-in Anthropic API for the end-to-end tests** (`e2e/stub-anthropic.mjs`): the real SDK talks to it, so every AI feature (recipes, meal plans, receipts and Photo Check) now runs end to end without a key. The receipt journey is now tested for real.
- **Tests:** 23 server, 20 client and a Photo Check end-to-end journey (phone and desktop).

**Changed**
- `GET /ai/status` includes `photoCheck`.
- `AiTask` can carry its own system prompt and images (already used by receipts).
- The end-to-end API now runs with AI on, pointed at the stand-in, instead of AI off. The Phase 4 journey now checks that the AI buttons appear.

**Fixed**
- The Phase 4 end-to-end journey's "Cook First" link was the logo (Home) on desktop, so its "no AI buttons" check passed without testing anything. It now uses the main navigation.

**Not in this release**
- Voice entry, other languages and grocery integrations. Photo Check and receipt scanning have not been tried against the real Anthropic API.

### [2.12.0] - 2026-10-02: Phase 6, part 3 (barcode and receipt scanning) · `09c1276`
**Added**
- **Barcode scanning** on Add Food (`GET /products/barcode`): the camera where the browser supports `BarcodeDetector`, and typing the number everywhere. The check digit is verified, then the server looks the number up in Open Food Facts (a `ProductClient` interface; time-out 5 seconds; a user agent that says who is asking) and returns the name, first brand and pack size (cl and dl converted to ml). The form is filled in from it; how long it lasts stays the person's choice. Not found, a failed look-up and a name that would break the wording rules all just ask for the name.
- **Receipt scanning** on Bulk add (`POST /parse/receipt`): the photo is scaled to 1600 px in the browser and read by Claude, which returns food lines only. The lines become rows to check, with lifespans suggested from your usual ones and then the reference list, a price per line and the added date taken from the receipt. Nothing is saved until you press Add. The photo is never stored or logged; it counts toward the daily AI limit and is refunded if unusable. Shown only when AI is on.
- **Prices in bulk add:** each row has an optional price (so receipts feed money saved and lost on Insights).
- `shared/src/barcode.ts`: the GS1 check-digit test (EAN-8, UPC-A, EAN-13, GTIN-14), used by the client and the server.
- `PRODUCT_LOOKUP_URL` setting (default Open Food Facts). The end-to-end tests point it at `e2e/stub-products.mjs`, so they never reach the internet.
- Error code `SERVICE_UNAVAILABLE` (503).
- **Tests:** 4 shared, 25 server, 17 client and a barcode end-to-end journey (phone and desktop).

**Changed**
- `AiTask` can carry its own system prompt and images; the receipt reader uses both.
- The receipt route alone accepts a request body up to about 4.5 MB; every other route keeps the 20 KB limit.

**Fixed**
- A request body over the size limit was a 500; it is now a 413 "That request is too large."

**Not in this release**
- Voice entry, other languages and grocery integrations. Safari and Firefox can't read a barcode from the camera (no `BarcodeDetector`), so they type the number.

### [2.11.0] - 2026-10-02: Phase 6, part 2 (shared households) · `ee6ecbe`
**Added**
- **Shared households** (`/household`): invite codes (single-use, a week, up to 5 open, shown as XXXX-XXXX and shared by hand), joining with a code (rate-limited like login), leaving, and a household of up to 6. Members share food, usage history and insights, the shopping list and the meal plan; favourites, reminder settings, currency, AI allowance and push devices stay personal.
- **Activity log:** who added, used, wasted or removed what, and who joined or left, newest first, with paging.
- **Reminders for everyone:** every member gets reminders for shared food, including food that came with a new member.
- **Leaving** takes the food, shopping items and meal plans you added, plus the history of that food, into a new household and drops your reminders for food that stayed behind.
- **Account deletion in a shared household:** you leave first, so only what you added is deleted; what you did to other people's food stays in their history with no name on it.
- New collections `invites` and `householdevents`; `householdId` on usage records, shopping items and meal plan entries (existing data is given its owner's household at start-up).
- **Tests:** 28 server, 11 client and a two-person end-to-end journey (phone and desktop).

**Changed**
- Food, history, insights, the shopping list and the meal plan are now scoped by **household** instead of by user; reminders, favourites, push subscriptions and AI usage are still scoped by user. The "every query is scoped" rule test now checks both.
- The meal plan has one meal a day per household (it was one per user).
- The Household link sits in Settings and the desktop sidebar.
- Wording: a message says "out of date" rather than using the word the wording guard keeps to the copy files.

**Not in this release**
- Barcode scanning (Open Food Facts), receipt scanning (Claude vision), voice entry, other languages and grocery integrations. The first two are decided and waiting; see the [Roadmap](#roadmap).

### [2.10.0] - 2026-10-02: Phase 6, part 1 (dark mode, your data) · `19248ad`
**Added**
- **Dark mode** with an **Appearance** choice in Settings (System, Light, Dark), kept on the device and applied before the first paint. New `--color-on-brand` token for text on brand-coloured buttons.
- **Download my data** (`GET /account/export`): one JSON file with the account, food, history, reminders, favourites, shopping list and meal plan. The password hash, push keys and internal owner ids are left out.
- **Delete my account** (`DELETE /account`): needs the password again (a wrong one is a 400 so it doesn't sign you out), then removes the account and every record it owns. Rate-limited like login.
- **Tests:** 7 server, 7 client and a Phase 6 end-to-end journey (phone and desktop).

**Changed**
- Toast and some buttons use theme tokens instead of fixed white, so they read in both themes.
- The demo seed script now gives the sample food prices and adds five finished items (used, wasted, partly wasted), so Insights shows data straight away.

### [2.9.0] - 2026-10-02: Phase 5 (insights) · `26c21c6`
**Added**
- **Insights screen** (`/insights`, `GET /insights`): used versus wasted this week with the waste rate and last week for comparison, an eight-week stacked bar chart (a table for screen readers sits beside it), the foods wasted most in the last 30 days, and tips. Linked from the dashboard, Settings and the desktop sidebar.
- **Optional price** on food (Add Food and the edit form; shown on Food Details). Usage records keep a `value`: a partly used item counts for the share used, the rest when wasted, and removals and unpriced items count for nothing. The price shown on an item shrinks with the quantity left.
- **Money saved and lost** on Insights, shown once some entries have a price, in the currency chosen in **Settings** (USD, EUR, GBP, CAD, AUD or INR; display only, nothing is converted).
- **Tips** from the numbers (a food wasted repeatedly, waste rising, nothing wasted, overdue food at home, adding prices). They are fixed rules, not AI, and are checked by the banned-wording test.
- **Tests:** 20 server, 10 client and a Phase 5 end-to-end journey (phone and desktop).

**Changed**
- Users now include `currency` (default `USD`); food items include `price`; usage records include `value`. Existing data needs no migration.
- The Settings link row for Insights sits above History.

**Also in this release**
- **Demo seed script** (`npm run seed -w server`): creates `demo@cookfirst.local` with 10 sample food items covering overdue, due, approaching and not-urgent, through the running API. Rerunning adds nothing; `--reset` re-seeds.

### [2.8.0] - 2026-09-30: Phase 4 (using the food) · `2bd172b`
**Added**
- **AI setup:** Anthropic's Claude API through the official `@anthropic-ai/sdk`, behind an `AiClient` interface. The key comes from `ANTHROPIC_API_KEY` and the model from `AI_MODEL` (default `claude-sonnet-5-5`, checked in Anthropic's models overview). AI features are on only when the key is set.
- **Safeguards on every AI request:** a daily limit of 20 per user (a failed request isn't counted), zod validation of the JSON answer, and a banned-wording check (the seven phrases plus "safe") with up to 3 attempts, then a 503.
- **Recipe ideas** on Cook First, built from the Cook First list in its order (read, never changed). "Save leftovers" on each idea.
- **Leftovers:** a "These are leftovers" box on Add Food, a short suggested lifespan, at most 4 days unless frozen, and a Leftovers tag.
- **Shopping list** that warns about matching food already at home, with its expected expiry.
- **Weekly meal plan** for today and the next six days, with the food each meal uses, plus AI suggestions for empty days as a draft to add or discard.
- New collections `shoppingitems`, `mealplanentries` and `aiusages`; a `leftover` field on food items. API: `/ai/status`, `/ai/recipes`, `/ai/meal-plan`, `/shopping…`, `/meal-plan…`.
- Error code `AI_UNAVAILABLE` (503).
- **Tests:** 24 server, 11 client, and a Phase 4 end-to-end journey, all with a fake AI client.
- A shared `Checkbox` with a 44 px tap area (leftovers box, shopping list).

**Changed**
- Phone navigation: Home · Cook First · Add food · Shopping · Plan. Settings moved to the header gear on every screen; History is reached from Settings.
- The banned phrases are defined once in `shared/src/wording.ts` and used by both the source guard and the AI check.
- `.env.example` and `render.yaml` list `ANTHROPIC_API_KEY` and `AI_MODEL`, both empty.
- The end-to-end API always runs with an empty `ANTHROPIC_API_KEY`, so it can never reach the real API.
- **Phase 7 spec:** "Use today" only when the expected expiry is later than today; confidence below 0.6 is low; the name is always editable.

**Fixed**
- Ticking a shopping item updates at once instead of waiting for the server.
- Editing an item no longer resets where it is kept: the edit form now starts from the item's storage (and leftover flag) instead of Fridge.

### [2.7.0] - 2026-09-30: Phase 3 (better reminders) · `dc1c904`
**Added**
- **Installable web app:** `manifest.webmanifest`, PNG icons (192, 512, maskable, Apple touch icon) and a service worker (`client/public/sw.js`).
- **Self-hosted Web Push** with the `web-push` library and VAPID keys from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Only the public key reaches the client (`GET /push/config`).
- **`PushProvider` interface** (`services/pushProvider.ts`): the notification service never talks to web-push directly, so Firebase could be added later for native apps.
- **`PushSubscription` collection:** user ID, endpoint, p256dh and auth keys, browser, last used. Deleted automatically when the push service returns 404 or 410. API: `POST` and `DELETE /push/subscriptions`.
- **Daily digest or one per item** at a chosen hour in the user's time zone (default: a daily summary at 08:00). API: `GET` and `PUT /notifications/delivery`.
- **Used and Snooze buttons** in notifications, via `POST /push/actions` and a single-item action token. If a button can't be completed, Food Details opens instead.
- **Settings → Push reminders:** permission is asked only after tapping "Turn on reminders". Also: Turn off on this device, blocked/unsupported/not-set-up messages, and an iPhone hint that the app must be added to the Home Screen first.
- `hourInTz` in `shared/src/dates.ts`; `npm run vapid:keys -w server`.
- **Tests:** 30 server, 18 client, 1 shared, a wording-guard check of the public files, and a Phase 3 end-to-end journey (at 375 px and desktop).

**Changed**
- In-app reminders are unchanged and never depend on push: push runs after in-app delivery in the hourly job, and its failures are logged and isolated.
- Login tokens with an audience are rejected, so an action token can never sign in.
- Logging out removes this device's push subscription (server and browser).
- `.env.example` and `render.yaml` list the three VAPID variables.
- The end-to-end API runs with a fresh VAPID key pair and the sign-up rate limit off.
- There was no `DeviceToken` collection to replace; `PushSubscription` is new.

### [2.6.0] - 2026-09-29: Phase 2 (realistic estimates) · `f59037d`
**Added**
- **Opened action:** "Opened" on the details screen asks for the opened date (default today) and days it lasts once opened, prefilled from new `openedDays` values in the reference list (16 foods). The expected expiry only ever gets shorter. "Mark as not opened" and Undo restore it. API: `POST` and `DELETE /foods/:id/open`.
- **Move between locations:** "Move" sends an item to the fridge, freezer or pantry and recalculates the expected expiry from today with that location's suggested lifespan (editable). API: `POST /foods/:id/move`.
- **Lifespans learned from your history:** `GET /suggestions/lifespans` gives the median of your last 10 entries for each food and location (at least 2 needed). Add Food shows them first with a ★ and "You usually set N days for this (from your last M)"; Bulk add uses them too.
- **Data model:** `lifespanBeforeOpened`, `enteredLifespanDays` and `enteredStorage` on food items, with a start-up backfill.
- **Tests:** 16 server, 5 client, and a Phase 2 end-to-end journey (at 375 px and desktop).

**Changed**
- End-to-end screenshots hide passing toasts so they don't cover the screen.

### [2.5.0] - 2026-09-29: Data model fields for later phases + Phase 1 (faster entry) · `b8fedd6`
**Added: data model (ahead of later phases)**
- **`householdId`:** on users (each starts in their own household), food items, usage records, shopping items and meal plan entries.
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
| **2. Realistic estimates** | Fridge, freezer and pantry lifespans · an "Opened" action that shortens expected expiry · lifespan suggestions learned from your own history | ✅ Done (v2.6.0) | – |
| **3. Better reminders** | Installable web app (PWA) · push notifications · a daily digest at a chosen time · "Used" and "Snooze" buttons in notifications | ✅ Done (v2.7.0), self-hosted Web Push | VAPID keys on the deployed server (`npm run vapid:keys -w server`) |
| **4. Using the food** | Leftovers as new short-lifespan items · a shopping list that warns about food already at home · AI recipe suggestions from Cook First · a weekly meal plan | ✅ Done (v2.8.0), Claude API | `ANTHROPIC_API_KEY` in `server/.env` to turn AI on |
| **5. Insights** | Used-versus-wasted dashboard · optional prices showing money saved or lost · a weekly summary with tips | ✅ Done (v2.9.0), no AI | – |
| **6. Sharing and scanning** | ~~Shared households with invites and an activity log~~ · ~~dark mode~~ · ~~data export~~ · ~~account deletion~~ (struck-through items are done in v2.10.0 and v2.11.0) · ~~barcode scanning~~ · ~~receipt scanning~~ (done in v2.12.0) · voice entry · multiple languages · grocery integrations | In progress: voice entry, languages and grocery integrations remain | Decided on 2026-10-02: barcodes from Open Food Facts (free, no key) and receipts read with Claude vision (needs `ANTHROPIC_API_KEY`); English only for now. Still open: which grocery partners (they need commercial API access) and which languages later |
| **7. Photo Check** | Take or upload a photo from Add Food, or "Check with photo" on Food Details, to identify a product and point out visible warning signs. Behind a feature flag; only when AI is enabled. See the [specification](#phase-7-photo-check-specification). | ✅ Done (v2.13.0), behind `PHOTO_CHECK=on` | `PHOTO_CHECK=on` and `ANTHROPIC_API_KEY` in `server/.env` |
| **8. Reminder sounds and meal reminders** | Three sounds and the channels, payloads and in-app chime that play them; a sound switch, a vibration switch and quiet hours; breakfast, lunch and dinner cooking reminders (plan, then a cached recipe idea, then the top Cook First items, else nothing) with Cooked it, Show recipe and Snooze 30 min; merged with the daily summary within 30 minutes; a 5-minute job | ✅ Done (v2.17.0). Placeholder sounds; unheard on a device. | Your licensed sound files |

### Phase 7: Photo Check specification

Recorded on 2026-09-30 and built in v2.13.0, after the scanning features in Phase 6, using the AI setup from Phase 4 (provider, "AI enabled" setting, daily limit, banned-phrase retry) and the activity log from Phase 6.

**Availability**
- Behind a feature flag, and available only when AI is enabled. With either off, no photo controls are shown.

**Flow**
1. The user takes or uploads a photo, either from **Add Food** or from a **"Check with photo"** button on **Food Details**.
2. The browser resizes it to at most **1600 px** on its longest side and sends it to `POST /api/parse/photo`.
3. The server passes it to the AI and **discards the image after processing**. It is never stored or logged.

**AI result:** JSON, validated with zod.
- `name`: the product name
- `category`
- `confidence`: how sure the identification is
- `warningSigns`: a list of `{ type, description }`, where `type` is one of `MOULD`, `DISCOLOURATION`, `WILTING`, `SLIME`, `BRUISING`, `DAMAGED_PACKAGING`, `SWOLLEN_PACKAGING` or `OTHER`, and `description` is short

The schema has **no field for good or normal condition**. Anything outside it fails validation.

**Identification (Add Food)**
- Pre-fill Add Food with the name and the reference-list lifespan suggestion.
- When confidence is **below 0.6** (on a 0–1 scale, kept as one constant), ask the user to type the name instead of pre-filling it.
- The name field stays **editable for every result**, whatever the confidence.

**Condition**
- **No signs found:** show **nothing about condition at all**. The app never shows a positive condition message.
- **Signs found:** show "Visible signs noticed: {descriptions}. A photo can't show everything, so check the item yourself before using it." with three options:
  - **Mark as wasted**
  - **Use today:** after confirmation, sets the expected expiry to today. Shown **only when the item's expected expiry is later than today**. When it is today or already past, "Use today" is hidden and only "Mark as wasted" and "Dismiss" are shown.
  - **Dismiss**

**Rules**
- Photo results may only make an item **more urgent**. They never extend its expected expiry.
- **Nothing changes without the user's confirmation.**
- The Cook First order is only ever changed by the resulting expected expiry, never by the AI directly.
- Add **`PHOTO_CHECKED`** to the activity event types.
- Each photo check counts toward the **AI daily limit**.
- The **banned-phrase retry** applies to all AI text, including every warning-sign description.

**Tests (with a mocked AI client)**
- Low-confidence identification asks the user to type the name.
- No signs found: no condition text is shown.
- Signs found: the warning and the three options are shown.
- The expected expiry only ever moves earlier.

**Decided on 2026-09-30**
- "Use today" appears only when the expected expiry is later than today, so it can never move the expiry later.
- Low confidence means below 0.6, kept as one constant; the name is always editable.

---

## Keeping this README up to date

Every change to the project should update this file in the same commit:

1. Add an entry under **[Unreleased]** in the [Changelog](#changelog), using **Added**, **Changed**, **Fixed**, **Removed** or **Breaking**.
2. When releasing, rename **[Unreleased]** to the new version and date, then add the commit hash.
3. Update [Project status](#project-status), [Roadmap](#roadmap) and any other affected sections: features, API, configuration, test counts.
4. If the screens change, run `npm run test:e2e` and copy the new screenshots from `e2e/screenshots/` into `docs/screenshots/`.
