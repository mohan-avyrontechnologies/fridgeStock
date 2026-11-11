# Cook First

**A perishable-food planner for households: it tells you what to cook first, so food gets eaten instead of thrown away.**

Log what you buy and Cook First works out each item's **expected expiry** automatically, from the date on the pack, your own history or a built-in food catalog. Everything is sorted so the most urgent food comes first, a daily **Cook First** list shows what to use today, and reminders, recipe ideas and a meal plan help you use it.

> **Food-safety boundary:** *Expected expiry is an estimate to help you plan. Always check your food before eating it.* The app never says that food is fit to eat, and a test scans every file for wording that would.

| | |
|---|---|
| **Version** | 2.23.0 ([CHANGELOG](CHANGELOG.md)) |
| **Status** | Feature-complete through Phase 8 plus automatic expiry; web app tested end to end; Android and iOS apps configured but not yet run on a device; not yet deployed ([Roadmap](docs/ROADMAP.md)) |
| **Runs on** | Web (installable PWA), Android and iOS (Capacitor) |
| **Requires** | Node.js 20.19 or later |
| **Documentation** | [docs/](docs/README.md): architecture, API, features, roadmap, testing, deployment, specifications |

---

## Screenshots

Captured by the Playwright end-to-end suite (`npm run test:e2e`) on a 375 px phone and a 1440 × 900 desktop.

| Dashboard | Cook First | Add food | Bulk add | Insights |
|---|---|---|---|---|
| ![Dashboard on a phone](docs/screenshots/mobile-02-dashboard.png) | ![Cook First on a phone](docs/screenshots/mobile-03-cook-first.png) | ![Add food on a phone](docs/screenshots/mobile-07-add-food.png) | ![Bulk add on a phone](docs/screenshots/mobile-11-bulk-add.png) | ![Insights on a phone](docs/screenshots/mobile-17-insights.png) |

| Shopping | Meal plan | Household | Barcode | Photo Check |
|---|---|---|---|---|
| ![Shopping list on a phone](docs/screenshots/mobile-15-shopping.png) | ![Meal plan on a phone](docs/screenshots/mobile-16-plan.png) | ![Household on a phone](docs/screenshots/mobile-20-household.png) | ![Barcode scanning on a phone](docs/screenshots/mobile-21-barcode.png) | ![Photo Check on a phone](docs/screenshots/mobile-23-photo-check.png) |

| Dashboard (desktop) | Sign in (desktop) |
|---|---|
| ![Dashboard on desktop](docs/screenshots/desktop-02-dashboard.png) | ![Sign in on desktop](docs/screenshots/desktop-10-login.png) |

---

## Main features

- **Automatic expected expiry.** You never type a lifespan. The estimate comes from the printed date, your household's usual lifespan, the catalog, the food's category or a short fallback, and every item says where its estimate came from. *Change estimate* lets you set your own.
- **Cook First list and priority order.** Most urgent first, the same order every time, with urgency shown as a colour **and** a text label.
- **Fast entry.** Camera screen with live barcode scanning (Open Food Facts) and reading the date on the pack; favourites, recent foods, bulk add, and receipt scanning with AI.
- **Using the food.** Mark as used (all or some), wasted or removed, with Undo; opened and moved items re-estimate (never later); leftovers; shopping list that warns about food already at home; a weekly meal plan.
- **Reminders.** In-app always; Web Push in browsers and Firebase push in the apps; daily summary or one per item; sounds, vibration and quiet hours; breakfast, lunch and dinner cooking reminders.
- **AI, optional.** Claude or Gemini (switchable) for recipe ideas, meal-plan drafts, receipts, Photo Check and reading dates. Each task goes to a fast or smart model, with 20 requests per person per day. **Everything works with AI off.**
- **Households.** Up to 6 people share food, history, insights, shopping list and meal plan, with an activity log.
- **Insights.** Used versus wasted, an 8-week chart, money saved and lost, and tips.
- **Your data.** Dark mode, a JSON export and account deletion. Product photos are stored privately with EXIF/GPS stripped.

The full list is in [docs/FEATURES.md](docs/FEATURES.md).

---

## Tech stack

| Layer | Technology |
|---|---|
| **Client** | React 19, Vite 8, React Router 7, Tailwind CSS 4, Zustand, service worker + manifest (PWA), `@zxing/browser` |
| **Mobile** | Capacitor 8 (Android and iOS) with native camera, ML Kit barcode scanning, Firebase push and secure storage |
| **Server** | Node.js, Express 5, Mongoose 9 (MongoDB 8), zod 4, JWT + bcrypt, node-cron, web-push, firebase-admin, multer + sharp |
| **AI** | `@anthropic-ai/sdk` (Claude, default in production) and `@google/genai` (Gemini, default in development) |
| **Shared** | `@cook-first/shared`: enums, API types, zod schemas, date utilities, the expiry estimator |
| **Language** | TypeScript 6.0 throughout (npm workspaces monorepo) |
| **Testing** | Vitest, Supertest + mongodb-memory-server, React Testing Library + MSW, Playwright + axe |
| **Tooling / CI** | ESLint, Prettier, GitHub Actions (checks, e2e, Android debug APK) |
| **Hosting** | MongoDB Atlas, Render (API), Vercel (web) |

Versions and the reasons behind each choice are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Folder structure

```
cook-first/
├── shared/                  @cook-first/shared, used by client and server
│   └── src/                 enums, api types, zod schemas, dates, food catalog, estimate.ts (expected expiry)
├── server/                  Express API
│   ├── src/
│   │   ├── config/          environment, AI provider, urgency threshold, database
│   │   ├── middleware/      JWT auth, zod validation, errors
│   │   ├── models/          Mongoose models and start-up migrations
│   │   ├── services/        all business logic: food, priority engine, reminders, AI clients, photos…
│   │   ├── controllers/     thin: parse → call a service → respond
│   │   ├── routes/          REST routes under /api
│   │   ├── jobs/            node-cron reminder and photo clean-up jobs
│   │   ├── tests/           API, unit, rules and structure tests
│   │   └── copy.ts          every message and AI prompt the server writes
│   └── scripts/             seed data, AI evaluation (eval:ai)
├── client/                  React app, plus the native projects
│   ├── src/                 api/, stores/, pages/, components/, lib/, platform/ (web vs native), test/, copy.ts
│   ├── android/             Android app (Capacitor)
│   ├── ios/                 iOS app (Capacitor)
│   └── assets/sounds/       reminder sounds (placeholders)
├── e2e/                     Playwright journeys, accessibility and text-size checks
├── docs/                    documentation, screenshots and the specifications
├── scripts/                 staging check, design screenshots
├── .github/workflows/       CI and the Android APK build
├── docker-compose.yml       local MongoDB
├── render.yaml              API deployment (Render)
└── CHANGELOG.md
```

---

## Getting started

**You need** Node.js 20.19+ (`.nvmrc` pins 20.19.0) and, for the database, Docker Desktop. Without Docker the API starts a built-in MongoDB instead (it downloads about 780 MB on first run).

```bash
git clone https://github.com/mohan-avyrontechnologies/fridgeStock.git fridgestock
cd fridgestock
npm install
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**Database, one command:**

```bash
docker compose up -d        # MongoDB 8 on localhost:27017
```

Then set `MONGO_URI=mongodb://localhost:27017/cook-first` in `server/.env`. (Or leave `MONGO_URI` empty to use the built-in database, kept in `server/.data/`.)

**Run it** in two terminals:

```bash
npm run dev:server          # API     → http://localhost:4000/api
npm run dev:client          # web app → http://localhost:5173
```

Open http://localhost:5173 and create an account. For a demo login with sample food, run `npm run seed -w server` while the API is running. It prints the email and password.

| If you see | Do this |
|---|---|
| `ERR_MODULE_NOT_FOUND … @cook-first/shared`, or Vite `Cannot find native binding` | `node_modules` is damaged (usually after moving the folder). Delete every `node_modules` folder and run `npm ci`. |
| `DBPathInUse … server\.data\mongod.lock` | Another API is using the built-in database. Stop it, or set `MONGO_URI`. |
| `EADDRINUSE` on 4000 or 5173 | Free the port, or change `PORT` / the Vite port and add the new address to `CLIENT_ORIGIN`. |

---

## Environment variables

`.env.example` files are committed; the real `.env` files are git-ignored. **Never commit a key.** In production the server refuses to start without `MONGO_URI` and `JWT_SECRET`.

### `server/.env`

| Variable | Default | Needed | What it is |
|---|---|---|---|
| `PORT` | `4000` | | API port |
| `MONGO_URI` | *(empty = built-in database)* | **Production** | MongoDB connection string |
| `JWT_SECRET` | development-only value | **Production** | Signs login tokens (HS256). Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `7d` | | How long a login lasts |
| `CLIENT_ORIGIN` | `http://localhost:5173` | **Production** | The web app's address(es) allowed by CORS, comma-separated |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | *(empty)* | For Web Push | Generate the pair with `npm run vapid:keys -w server`. The private key never leaves the server. |
| `AI_PROVIDER` | *(empty = `gemini` in development, `anthropic` in production)* | | `gemini` or `anthropic`. Anything else stops the server at startup. |
| `ANTHROPIC_API_KEY` | *(empty)* | For AI with Claude | AI features are on only when the chosen provider's key is set |
| `AI_MODEL` | `claude-sonnet-5-5` | | Claude model ID |
| `GEMINI_API_KEY` | *(empty)* | For AI with Gemini | Google Gemini key |
| `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART` | `gemini-2.5-flash`, `gemini-2.5-pro` | | The fast model reads dates and receipts; the smart one names food in photos and writes ideas |
| `GEMINI_TIER` | *(empty = free)* | | Set `paid` for a paid key. A free-tier key in production prints a warning at startup. |
| `PHOTO_CHECK` | *(empty = off)* | | `on` turns on Photo Check (also needs AI) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | *(empty)* | For app push | Firebase service account; the private key on one line with `\n` |
| `APNS_BUNDLE_ID` | *(empty)* | For iPhone push | The iOS app ID (APNs topic) |
| `PUBLIC_API_URL` | *(empty)* | For Android buttons | `https://<api>/api`, called by the Used/Snooze notification buttons |
| `PRODUCT_LOOKUP_URL` | *(empty = Open Food Facts)* | | Barcode look-up service (only the e2e tests change it) |

### `client/.env` and `client/.env.native`

| Variable | Default | What it is |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | The API address. `client/.env.native` holds the one built into the Android and iOS apps. |

More detail, including `ANTHROPIC_BASE_URL`, `APNS_KEY_ID` and `APNS_TEAM_ID`, is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Running the tests

```bash
npm run lint                # ESLint, all packages
npm run format:check        # Prettier
npm run typecheck           # TypeScript: shared, server, client
npm test                    # unit + API + component tests (shared, server, client)
npm run test:e2e            # Playwright journeys on a phone and a desktop viewport
```

`npm test` runs about 1,070 tests: shared 83, server 545 (on a throwaway in-memory MongoDB) and client 439 (jsdom + MSW, at most 2 workers). The end-to-end suite starts its own API, web app and stand-ins for Open Food Facts and the Claude API on separate ports, so it needs no keys and never touches your data. **No test ever calls a real AI API.** What each suite covers is in [docs/TESTING.md](docs/TESTING.md).

---

## Building

One command builds every workspace (`shared/dist`, `server/dist`, `client/dist`):

```bash
npm run build
```

### Web app

`npm run build` puts the production web app in `client/dist/`. Serve it from any static host (the repo has `client/vercel.json` for Vercel) and run the API with `npm start -w server` (`render.yaml` for Render). Step-by-step HTTPS staging is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Android

**From GitHub, nothing to install:** every push to `main` (and every `v*` tag) runs the **Android debug APK** workflow. Open the repository's **Actions** tab → *Android debug APK* → the latest run → **Artifacts** → download `cook-first-debug-apk`, unzip it, copy `app-debug.apk` to your phone and open it (allow *Install unknown apps* for your file manager or browser). You can also start a build by hand with *Run workflow*.

Before the APK is useful on a phone, set the repository **variable** `NATIVE_API_URL` to your deployed API (`https://<api>/api`) under *Settings → Secrets and variables → Actions*. Without it the app is built to talk to `localhost`, which a phone can't reach. For push, also add your Firebase `google-services.json` as the **secret** `GOOGLE_SERVICES_JSON`.

**Locally** (needs Android Studio with the JDK and Android SDK Platform 36):

```bash
npm run cap:sync -w client          # build the web app for the apps and copy it into android/ and ios/
cd client/android && ./gradlew assembleDebug
# → client/android/app/build/outputs/apk/debug/app-debug.apk
```

A debug APK points at the API in `client/.env.native` (copy it from `client/.env.native.example`). Push needs your own `google-services.json`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#native-apps-android-and-ios).

### iOS (needs a Mac)

```bash
brew install cocoapods              # once
npm install
npm run cap:sync -w client          # also runs "pod install" on a Mac
npm run ios -w client               # opens client/ios/App/App.xcworkspace in Xcode
```

In Xcode: select the **App** target → *Signing & Capabilities* → choose your **Team**; check **Push Notifications** and **Background Modes → Remote notifications**; add `GoogleService-Info.plist`; then run on a real iPhone (push and the barcode scanner need a device). *Product → Archive* makes an App Store build. Full steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#5-build-and-run-on-ios-xcode-on-a-mac).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:server` / `npm run dev:client` | API with auto-reload / Vite dev server |
| `npm run build` | Build all three workspaces |
| `npm run lint`, `npm run format`, `npm run format:check`, `npm run typecheck` | Code quality |
| `npm test`, `npm run test:e2e` | Tests |
| `npm run seed -w server` | Demo account with sample food (`-- --reset` to re-seed) |
| `npm run vapid:keys -w server` | Generate a Web Push key pair |
| `npm run eval:ai -w server -- --provider both` | Compare Claude and Gemini on a local sample set: accuracy, latency, tokens, cost |
| `npm run cap:sync -w client` | Build the web app for the apps and copy it into Android and iOS |
| `npm run android -w client` / `npm run ios -w client` | Open Android Studio / Xcode |
| `npm run native:set-app-id -w client -- <id>` | Set the app ID everywhere (`--check` to verify) |
| `npm run sounds:sync -w client` | Copy the reminder sounds into the native projects |
| `npm run check:staging -- --api <url> --client <url>` | Check a deployment from the outside |
| `npm run design:shots -- <stage>` | Screenshots of every screen, light and dark |

---

## Documentation

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview, data model, priority engine, automatic expiry pipeline, AI model routing, rules and security |
| [docs/API.md](docs/API.md) | Every endpoint, request and response, and the error format |
| [docs/FEATURES.md](docs/FEATURES.md) | Every feature and screen |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Finished and planned phases, including the Photo Check specification |
| [docs/TESTING.md](docs/TESTING.md) | What each test suite covers |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | HTTPS staging, native app set-up, Firebase and signing |
| [docs/specs/](docs/specs/README.md) | The original BRD, FRD, SRD and TDD, and where the app differs from them |
| [CHANGELOG.md](CHANGELOG.md) | Every release |

**Contributing:** commit after each finished feature with a conventional message (`feat(scope): …`, `fix`, `test`, `docs`, `chore`), add a CHANGELOG entry under **[Unreleased]**, and keep `npm run lint`, `typecheck` and `npm test` passing.
