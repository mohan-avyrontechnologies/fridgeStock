# Roadmap

What is finished, what is next, and the specification for Photo Check. Release-by-release detail is in the [CHANGELOG](../CHANGELOG.md).

---

## Project status

As of v2.23.0 (2026-10-23).

| Item | Status |
|---|---|
| All MVP functional requirements (FR-AUTH, FOOD, EXP, PRI, UI, NOT, USE, VAL) | ✅ Done |
| Post-MVP Phases 1–5, Phase 6 (except voice entry, languages and grocery integrations), Phase 7 (Photo Check) and Phase 8 (reminder sounds and meal reminders) | ✅ Done |
| Phase 9: automatic expected expiry, reading the date on a pack, a second AI provider with model routing | ✅ Done (v2.23.0) |
| Tests: shared 83 + server 545 + client 439 = **1,067**, plus the Playwright end-to-end suite | ✅ Passing |
| ESLint, Prettier and typecheck on all packages | ✅ Clean |
| All project rules (see [Architecture → Project rules](ARCHITECTURE.md#project-rules)) | ✅ Met, each one checked by a test |
| Code on GitHub (`mohan-avyrontechnologies/fridgeStock`, public) | ✅ Pushed with tag `v2.23.0` |
| CI (lint, format, typecheck, tests, build, end-to-end) and the Android debug APK | ✅ Workflows in `.github/workflows/`; they run on every push |
| Online deployment | ⏳ Configuration and a step-by-step guide are ready ([Deployment](DEPLOYMENT.md)); it needs your own Atlas, Render and Vercel accounts |
| Android and iOS apps (Capacitor) | ⚠️ The Android debug APK is built by CI; the apps have **not been run on a device** yet, and iOS needs a Mac to build |
| Photo Check and the AI date reader against the real APIs | ⚠️ Tested with stand-ins and fakes only. Run `npm run eval:ai` with real samples before choosing a provider for production |
| Reminder sounds | ⚠️ Placeholders until licensed files are added |

---

## Roadmap

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
| **9. Automatic expiry and AI choice** | Expected expiry estimated from the printed date, your history, the catalog, the category or a fallback, never typed · reading the date on a pack (on the device, typed, or with AI) · Gemini next to Claude, with fast and smart models per task · an evaluation script to compare them | ✅ Done (v2.23.0) | A Gemini or Claude key to turn AI on |

### Planned

| Next | Scope | Needs from you |
|---|---|---|
| **Deploy staging** | MongoDB Atlas, the API on Render, the web app on Vercel, over HTTPS ([Deployment](DEPLOYMENT.md)) | Atlas, Render and Vercel accounts; `JWT_SECRET`, VAPID keys and an AI key on the API host |
| **Phones** | Install the CI debug APK on Android; build on a Mac for iPhone; check the list in [Deployment → What to check on a real phone](DEPLOYMENT.md#what-to-check-on-a-real-phone) | `NATIVE_API_URL` and `GOOGLE_SERVICES_JSON` in GitHub; a Mac with Xcode and an Apple Developer account |
| **Choose the production AI provider** | Run `npm run eval:ai -w server -- --provider both` on real date, receipt and photo samples; compare accuracy and cost | Sample photos, and keys for both providers |
| **Photo Check, live** | Try Photo Check against the real API with real photos before turning `PHOTO_CHECK=on` in production | – |
| **Licensed sounds** | Replace the placeholder reminder sounds | Licensed `.wav`/`.caf` files |
| **Phase 6, the rest** | Voice entry · more languages · grocery integrations | Which languages; grocery partners (they need commercial API access) |
| **App stores** | A real app ID, signing, store listings | App ID, keystore, Apple and Google developer accounts |

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

## MVP build phases

The project was built in these phases; each one is complete.

| Phase | Server | Client | Status |
|---|---|---|---|
| **1. Scaffold** | npm workspaces (`client`, `server`, `shared`); TypeScript, ESLint, Prettier; Express with `/api/health`; MongoDB `docker-compose.yml`; `.env.example` files; CI workflow; shared date functions with tests | Vite app | ✅ |
| **2. Authentication** | User model; register, login and current-user endpoints; JWT middleware, error handler, zod validation middleware, rate limiting; API tests | Sign-up and log-in screens, auth store, protected routes, 401 handling | ✅ |
| **3. Food and priority** | Priority engine and its unit tests first; food item model; food endpoints (except use, waste and delete); API tests including cross-user checks | Dashboard, Add Food, Food Details (view and edit) | ✅ |
| **4. Usage** | Use, waste and delete endpoints; usage record model; usage history endpoint; tests | Action buttons, Cook First, History | ✅ |
| **5. Reminders** | Notification model, scheduling logic, `dispatchDue`, hourly job, preferences endpoint; tests | Bell with count, Reminders screen, Settings | ✅ |
| **6. Polish and ship** | Banned-phrase test; deployment config (`render.yaml`, `client/vercel.json`) | Every empty, loading and error state; Playwright end-to-end tests; the README (setup, environment variables, running tests) | ✅ (deployment itself not yet done; see the [Roadmap](#roadmap)) |
