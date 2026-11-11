# Changelog

All notable changes to this project are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org/).

### [Unreleased]
**Changed**
- **The app is now called FridgeStock** (it was Cook First), and so is the list of food to use first. This breaks things on purpose:
  - The route is now `GET /api/foods/fridgestock`, not `/api/foods/cook-first`.
  - Fields named `cookFirst…` are now `fridgeStock…`.
  - The app id is now `com.example.fridgestock`, so this is a new app on Android and iOS, and the old app has to be removed by hand.
  - The browser storage keys are now `fridgestock-*`, so everyone is signed out once and their theme is reset.
  - The workspace packages are now `@fridgestock/*`.
  - The local database names are now `fridgestock*`.
  - The Render service in `render.yaml` is now `fridgestock-api`.
  - The repository is now `mohan-avyrontechnologies/fridgeStock` (it was `rugvailabs/cook_first`, then `rugvailabs/fridgestock`).

**Added**
- **Python server, Phase 2**: food items (adding, bulk adds, editing, using, wasting, removing, undo, opening, moving and "use today"), FridgeStock and the priority engine, usage history, favourites and learned lifespans, with reminders scheduled and delivered in the app. `npm run compare:py` runs one journey on both servers and compares every response and stored document; all 84 checks match. pytest: 406 tests (`pytest -m phase2`).
- **Python server, Phase 1** (`server-py/`; notes in [docs/PYTHON_MIGRATION.md](docs/PYTHON_MIGRATION.md#progress)). The server runs (`npm run dev:server-py`) with settings, the MongoDB connection, Mongoose's indexes and the start-up migrations, Express's HTTP behaviour (helmet, CORS, body limits and encodings, ETags, the error format), logins and the auth rate limit, and `GET /health`, `POST /auth/register`, `POST /auth/login`, `GET`/`PUT /auth/me`, `GET /push/config` and `GET /ai/status`. Its tokens are byte-for-byte the Node server's, each server accepts the other's tokens and password hashes, and 38 raw HTTP requests got identical answers from both. pytest: 237 tests, grouped by phase (`pytest -m phase1`).
- **Python server, Phase 0** (`server-py/`, branch `python-backend`; plan in [docs/PYTHON_MIGRATION.md](docs/PYTHON_MIGRATION.md)). No routes yet: the Python port of the shared logic (dates, alerts, barcodes, wording, the catalog, `estimateExpiry`, the priority engine and the server's wording), uv with ruff, pyright (strict) and pytest, a CI job on Python 3.12 and 3.13, and a local embedded MongoDB (`npm run db:py` keeps its data in `server-py/.data`; `npm run db:py:empty` starts an empty one for tests).
- **Shared data** (`shared/data/*.json`): the catalog, category defaults, banned phrases, each locale's day/month order and all of the server's wording (`messages.json`, from `server/src/copy.ts`) are now JSON that the TypeScript code and the Python server both read. The TypeScript exports are unchanged; the server reads its wording through `@fridgestock/shared/server-messages`, so the AI prompts never ship in the web app.
- **Shared test cases** (`shared/test-cases/*.json`): about 2,050 inputs with expected outputs that the Vitest suites (`shared/src/testCases.test.ts`, `server/src/tests/sharedCases.test.ts`) and pytest (`tests/test_shared_cases.py`) must both pass. `validation.json` records what every request schema answers (the first problem's exact message and field, or the parsed value) for about 1,300 inputs, written by `npm run cases:validation -w shared`; Vitest fails if a schema or a zod upgrade changes an answer.
- **`JOBS_ENABLED`** on the server (on by default): `false` starts no scheduled jobs, so exactly one server runs them while two share a database. Anything other than an on/off word stops the server.

**Fixed**
- **Python server: time zones came from the machine on Linux** (`localtime` counted as a zone there, so CI failed). They now come only from the tzdata package.
- **A printed date's day/month order no longer depends on the machine.** For a language the runtime had no data for (such as `xx`), Node quietly used the computer's own locale (`en-IN` on one PC, usually `en-US` on a server), and different Node and browser versions disagreed on some locales (`en-CA` is year-month-day in CLDR 48 and day-first in older data). `dayMonthOrder` now looks the tag up in `shared/data/date-order.json` (recorded from CLDR 48), the same everywhere, and an unknown language has no order, so the earlier reading is used.

**Security**
- **Notification button tokens** (`POST /push/actions`) now work for 24 hours instead of 7 days, carry out one action once (a second tap, or the other button on the same notification, is a 401 "This notification button has already been used."), and are unique to each notification. Buttons on notifications sent before this change stop working and open Food Details instead.

**Fixed**
- **A refused notification button no longer signs you out on iPhone.** The app's own call to `POST /push/actions` sent the login token, and its 401 (an expired or already-used action token, such as from a double tap) went to the "401 means sign out" handler. It now sends no login and never signs out; the item opens instead. The web service worker and the Android receiver were already safe (they send no login and only open the item), and now have tests (`service-worker.test.ts`, `native-config.test.ts`, `platform-native.test.ts`).
- A request body the server can't read (an unknown or corrupt `Content-Encoding`) is a 415 or 400 `VALIDATION_ERROR`, not a 500.
- The account export no longer includes the push service's own delivery errors on reminders.

**Changed**
- The validation messages (`MESSAGES` in `shared/src/schemas.ts`) live in `shared/data/validation-messages.json`, so the Python server reads the same words; the export is unchanged and the wording guard scans the file. `validation.json` now also tries emoji in every text field (1,494 cases): zod counts them as one character, while Mongoose's `maxlength` counts two.
- The shared package's build now writes `dist/src` and `dist/data` (exports updated); the client and server `tsconfig.json` set `resolveJsonModule`. The wording guard also scans `shared/data`, with `messages.json` and `estimate-copy.json` as copy files.
- Path and query values are checked with shared zod schemas: `:meal` (`mealParamSchema`), `:date` (`mealDateParamSchema`, so `DELETE /meal-plan/:date` with a date that isn't real is now a 400), `?meal` (`mealQuerySchema`) and `:code` (`inviteCodeParamSchema`).
- `docs/API.md` lists all 68 routes in router order, with the public routes, every rate limit and the `AI_UNAVAILABLE` code; a test keeps it in step with the router.
- A root `.env.example` points to the package's own example files.
- Tests: every route is a 401 without a login (except the four public ones); another household's item is a 404 for undo, use-today, open, undo-open and move; favourites and meal-plan food are checked across accounts.

### [2.23.0] - 2026-10-23: automatic expiry, a second AI provider, and the release set-up
**Added**
- **Automatic expected expiry** (`feat(expiry)`). Nobody types a lifespan any more: `estimateExpiry` (`shared/src/estimate.ts`) takes the expected expiry from the date printed on the pack, the household's own usual lifespan (only when shorter), the catalog, the category default, or a 3-day fallback. When several apply, the earliest date wins. Items store `expirySource`, `estimateExplanation`, `printedDate` and `printedDateType`. Cards show the source, Food Details shows the explanation, and *Change estimate* sets your own (source `USER`). Opening, moving and Photo Check only ever shorten an estimate, and only lifespans people typed are learned from. See [Architecture](docs/ARCHITECTURE.md#automatic-expiry-pipeline).
- **Reading the date on a pack** (`feat(scan)`). After a barcode or product photo the camera asks for the date (always skippable). It is read on the device, or typed as printed, using the person's locale for day/month order. With AI on, `POST /parse/date` is an extra: the fast model only copies the text, and the server parses it and ignores dates more than 2 years ahead or 30 days past.
- **Google Gemini as a second AI provider** (`feat(ai)`), chosen with `AI_PROVIDER` (Gemini by default in development, Claude in production), with `GEMINI_API_KEY`, `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART` and `GEMINI_TIER`. The server warns at startup when production uses a free-tier Gemini key.
- **Model routing** (`feat(ai)`): each AI task asks for a `fast` model (dates, receipts) or a `smart` one (Photo Check, recipe ideas, meal plans). See [AI model routing](docs/ARCHITECTURE.md#ai-model-routing).
- **AI evaluation script** (`feat(ai-eval)`): `npm run eval:ai -w server` compares providers on accuracy, valid answers, banned wording, latency, tokens and cost.
- **Android debug APK in CI**: the *Android debug APK* workflow builds `app-debug.apk` on every push to `main` and every `v*` tag and uploads it as a downloadable artifact.
- **Documentation**: a shorter README, plus `docs/` (architecture, API, features, roadmap, testing, deployment, specifications) and this `CHANGELOG.md`.
- Tests: `estimate.test.ts`, `expiryEstimate.test.ts`, `aiProviders.test.ts`, `evaluation.test.ts`, `noAiJourney.test.ts` (the whole journey with AI off), `printedDate.test.ts` and `expiry.test.tsx`. Totals: shared 83, server 545, client 439.

**Changed**
- **Rate limits**: a 429/529 or quota error is retried once after 2 seconds, then the person sees "AI is busy, try again later." and the request doesn't count toward the daily 20. The Anthropic SDK's own retries are off.
- Add Food no longer has a lifespan box by default; *Change estimate* opens it. Bulk add's lifespan column is optional ("estimated").
- `POST /foods` and `POST /foods/bulk`: `addedDate` and `lifespanDays` are optional; `printedDate`, `printedDateType` and `category` are new.
- Client tests run on at most 2 workers (more ran out of memory on a machine with little free RAM).
- `.gitignore` now also covers `.env.*` (except the examples), service-account, VAPID and signing-key files, native build folders, `test-results/`, `tmp/` and the AI evaluation's real samples and photos.
- Version 2.23.0 in every `package.json` and the Android `versionName`.

**Fixed**
- The end-to-end API pins `AI_PROVIDER=anthropic`, so the Claude stand-in is used. With the new default it would have been Gemini, with AI off.
- `client/android/gradlew` is now executable in git, so the Android build runs on Linux and macOS.
- Eight end-to-end journeys still expected a prefilled lifespan box. They now check the estimate (its source and explanation), use *Change estimate* where they set their own days, and check that a longer "usual" lifespan doesn't replace a shorter catalog one. The validation journey clicks the sheet's own *Add food* button, so it no longer races the page behind it.

### [2.22.0] - 2026-10-03: design and usability, stage 5 (wording and polish) · `c4afcfb`
**Changed**
- **One name for each action, from its button to its toast:** **Mark as used** → "Marked as used", **Mark all as used** and **Mark some as used** → "Marked some as used", **Mark as wasted** → "Marked as wasted", **Mark as opened** → "Marked X as opened", **Move** → "Moved X", **Add food** → "Added X", **Save changes** → "Saved changes", **Save as favourite** → "Saved X as a favourite". The cards, the swipe actions, the sheets and Food Details all use the same words.
- **Sentence case everywhere:** "See history", "Photo check", "Fill in the form"; no all-capitals styling; no symbols standing in for icons (the ★ and ☆ are icons now).
- **Every error says what happened and what to do** (`lib/errors.ts`, `describeError`): no connection ("Check your internet and try again"), signed out ("Sign in again"), the server had a problem ("Try again in a moment"), a limit ("Wait a minute"), or the server's own reason when it explains a mistake in what was typed. They replace "Something went wrong" and "Couldn’t save that" everywhere (saving, adding, undoing, moving, the meal plan, the shopping list, settings, loading food).
- **Every empty state has a short explanation and a button:** FridgeStock (Plan a meal, Add food), History (Go to Home), Reminders (Choose reminder settings), Shopping (Add an item, which moves to the field), the household activity (Add food); and every "couldn’t load" screen has **Try again** (`LoadError`), as does Food Details, which also offers Go to Home.
- **Text size:** nothing is cut off or runs off the screen at 200% text size on any main screen, the first-run guide or the tab bar (long names wrap instead of being truncated, badges wrap, a card's picture stacks above its text when there isn't room, the guide's buttons wrap). The tab labels follow the text size up to 125%, because a tab bar has no room for more.
- Photo thumbnails are a fixed size so the words get the room.

**Added**
- **A "Skip to main content" link** as the first Tab stop on every signed-in screen; the main area is the target. Each screen has one heading and one main area.
- Tests: `wording.test.ts` (13: sentence case across every string in the copy file, no all-capitals styling, button-to-toast names, the error messages), empty states and load errors, and end-to-end: **200% text size** on every main screen, the tab bar and the guide (`textsize.spec.ts`), a **keyboard-only** journey (skip link, open a card, mark as used, the Add food dialog's focus), and **axe with a dialog open** (Add food, Mark as used, More) in light and dark.


### [2.21.0] - 2026-10-03: design and usability, stage 4 (adding food and first run) · `d21d5af`
**Added**
- **Add food is a bottom sheet** (on a phone it slides up; on a larger screen it is a centred dialog). It is a real dialog: focus starts on the food name, Tab stays inside, Escape or the backdrop closes it and focus goes back. The **camera is first**, then favourites, then **Recent** (the foods you added most recently, one of each, without your favourites): tapping one fills the form from that food (amount, unit, lifespan, place) for you to check and save.
- **A + / - stepper for quantity** (a half for kilos and litres, 50 for grams and millilitres, 1 for the rest), with the number still typeable. Quantity and price open a **decimal keyboard** and lifespan a **numeric** one; the lifespan **quick-pick chips** (1, 2, 3, 5, 7 and 14 days) stay.
- **A three-step first-run guide** (`/welcome`), shown once to a new account and available again from **Settings → How FridgeStock works**: (1) what "expected expiry" means, with the disclaimer in a note; (2) add the first food with the **camera**, your **favourites**, or a tap on **common foods** (added to the fridge with their usual unit and lifespan); (3) choose **meal times** and turn on **reminders**. The phone's permission for notifications is asked **only** when "Turn on reminders" is tapped here or in Settings (a test checks no step asks earlier). Skip is on every step, finishing or skipping saves that it has been seen, and a failure to save never traps anyone in it.
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
- **A new bottom tab bar** on phones: **Home**, **FridgeStock** (with its count), a large central **Add food** button, **Shopping**, and **More**. More opens a sheet with **Meal plan**, **Settings**, **History**, **Insights** and **Household** (Meal plan joins the four you asked for, because it no longer has a tab and would otherwise be hard to reach). The sidebar on desktop is unchanged.
- **Home now starts with a "FridgeStock today" panel:** the most urgent food (up to six) as large cards in a row you scroll sideways, each with its photo or category icon, name, days left in words and the urgency badge; below it the **current meal's suggestion** (today's planned breakfast, lunch or dinner, otherwise "start with" the two most urgent items; the meal is chosen by the time of day in your time zone) and a **Cooked something** button that opens the leftovers form. When nothing is urgent the panel is a calm message with **Plan a meal** and **Add food**.
- **Location chips** (**All**, **Fridge**, **Freezer**, **Pantry**) filter the full inventory below the panel, which stays in priority order. The panel is not filtered.
- Tests: 15 for Home and the tab bar (`home.test.tsx`).

**Changed**
- The four count tiles at the top of Home (past, today, use soon, not urgent) are gone, so the panel is first as asked; the same counts are in the FridgeStock badge and on Insights.
- On phones the meal plan is reached through More.


### [2.18.0] - 2026-10-03: design and usability, stage 1 (design system) · `79054fc`
**Added**
- **Design tokens** in `client/src/index.css`: the light and dark palettes and urgency colours from the design brief, 16 px card and 12 px button corners, and the type scale (see [Design system](docs/ARCHITECTURE.md#design-system-v218)).
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
`- **Meal-time cooking reminders** (`services/mealReminderService.ts`). The job now runs **every 5 minutes** (`*/5 * * * *`). At each meal's time (and up to 30 minutes after, if the job was late) a reminder is sent once a day, chosen by the pure, unit-tested `chooseMealContent`: today's planned meal for that meal; else, with AI on, one of today's cached recipe ideas for that meal type (never one already used for another meal that day); else a plain message naming the top FridgeStock items with their days left; else nothing when FridgeStock is empty and no meal is planned. Buttons: **Cooked it** (the leftovers form, pre-filled), **Show recipe** and **Snooze 30 min** (sent again 30 minutes later; a `SNOOZE_MEAL` action with its own one-day meal token).
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
- **Capacitor** in the client workspace, with an Android and an iOS project (`client/android`, `client/ios`; iOS uses CocoaPods because the ML Kit scanner and Firebase need it). App name **FridgeStock**; the app ID is the placeholder `com.example.fridgestock` in one place each, and `npm run native:set-app-id -w client -- <id>` changes every place (it keeps the Android Java package, so no files move).
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
- **Photo Check** (`POST /parse/photo`), behind the `PHOTO_CHECK=on` flag and only when AI is on (`photoCheck` in `GET /ai/status`). **Identify from a photo** on Add Food pre-fills the name (and, for a known food, its usual lifespan and place) when the AI is at least 0.6 sure; **Check with photo** on Food Details shows visible warning signs with **Mark as wasted**, **Use today** and **Dismiss**. No warning signs means nothing about condition is shown. See the [specification](docs/ROADMAP.md#phase-7-photo-check-specification).
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
- The Phase 4 end-to-end journey's "FridgeStock" link was the logo (Home) on desktop, so its "no AI buttons" check passed without testing anything. It now uses the main navigation.

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
- Barcode scanning (Open Food Facts), receipt scanning (Claude vision), voice entry, other languages and grocery integrations. The first two are decided and waiting; see the [Roadmap](docs/ROADMAP.md#roadmap).

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
- **Demo seed script** (`npm run seed -w server`): creates `demo@fridgestock.local` with 10 sample food items covering overdue, due, approaching and not-urgent, through the running API. Rerunning adds nothing; `--reset` re-seeds.

### [2.8.0] - 2026-09-30: Phase 4 (using the food) · `2bd172b`
**Added**
- **AI setup:** Anthropic's Claude API through the official `@anthropic-ai/sdk`, behind an `AiClient` interface. The key comes from `ANTHROPIC_API_KEY` and the model from `AI_MODEL` (default `claude-sonnet-5-5`, checked in Anthropic's models overview). AI features are on only when the key is set.
- **Safeguards on every AI request:** a daily limit of 20 per user (a failed request isn't counted), zod validation of the JSON answer, and a banned-wording check (the seven phrases plus "safe") with up to 3 attempts, then a 503.
- **Recipe ideas** on FridgeStock, built from the FridgeStock list in its order (read, never changed). "Save leftovers" on each idea.
- **Leftovers:** a "These are leftovers" box on Add Food, a short suggested lifespan, at most 4 days unless frozen, and a Leftovers tag.
- **Shopping list** that warns about matching food already at home, with its expected expiry.
- **Weekly meal plan** for today and the next six days, with the food each meal uses, plus AI suggestions for empty days as a draft to add or discard.
- New collections `shoppingitems`, `mealplanentries` and `aiusages`; a `leftover` field on food items. API: `/ai/status`, `/ai/recipes`, `/ai/meal-plan`, `/shopping…`, `/meal-plan…`.
- Error code `AI_UNAVAILABLE` (503).
- **Tests:** 24 server, 11 client, and a Phase 4 end-to-end journey, all with a fake AI client.
- A shared `Checkbox` with a 44 px tap area (leftovers box, shopping list).

**Changed**
- Phone navigation: Home · FridgeStock · Add food · Shopping · Plan. Settings moved to the header gear on every screen; History is reached from Settings.
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
  - Suggestions are labelled as planning estimates from the "FridgeStock reference list" and are always editable.
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
- **End-to-end spec journey:** sign up → chicken (1 day) and eggs (8 days) → only chicken in FridgeStock → mark used → gone from the dashboard and FridgeStock. Now 7 journeys, 14 tests.
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
- **`dispatchForUser` renamed `dispatchDue`.** It now also runs at the start of `GET /foods`, wrapped so a reminder failure can never affect the inventory or FridgeStock.
- **The node-cron job** now runs **hourly** (`0 * * * *`) instead of every 15 minutes.

**Changed: screens**
- **Dashboard:**
  - the header shows the full name, the bell (at every screen size) and a new settings icon
  - FridgeStock always shows the top 3 with "See all", or "Nothing urgent right now."
  - the empty list reads "Your fridge is empty. Add your first item."
  - the fixed centre button is now labelled "Add food"
- **Add food:**
  - a unit **dropdown** (defaults to pcs)
  - notes behind an "**Add note**" link
  - the preview reads "Expected expiry: Thu, 1 Oct (2 days left)", with the disclaimer beneath it
- **Food details:** "**Used all**", "**Used some**", "**Wasted**" and "**Remove**" buttons. Closing actions need **one confirmation**, and closed items show a read-only note.
- **Cards** (FridgeStock and dashboard): **Used** (all or some) and **Wasted** buttons instead of "Update".
- **FridgeStock empty state:** "Nothing needs attention right now."
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
- **Priority engine:** `prioritise(items, today)` now returns `{ items, fridgeStock, summary }` (with `total`).
- **Required priority-engine tests:** a zero-day lifespan is DUE on the day it's added; running twice gives identical output; chicken, spinach, milk, eggs orders correctly with only chicken and spinach in FridgeStock; urgency switches exactly at 4, 3, 1, 0 and −1 days.
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
- **`shared` workspace package** (`@fridgestock/shared`), used by both client and server:
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
- **Required estimate line tests:** client tests and Playwright checks for the line on Add Food and FridgeStock.
- **README:** rewritten as the full project reference, with a [Project rules](docs/ARCHITECTURE.md#project-rules) section.

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
  - a two-column FridgeStock grid
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
- **Priority and FridgeStock:** the priority engine, four urgency labels and the FridgeStock list.
- **Dashboard and history:** the dashboard, used / partly used / wasted / removed actions with usage records, and History.
- **Reminders:** in-app reminders with preferences and retries.
- **Privacy and wording:** each user sees only their own data, plus the "safe"-wording test.
- **Development:** a built-in MongoDB fallback.
- **Tests and CI:** 76 server tests, 10 client tests and a CI workflow.
