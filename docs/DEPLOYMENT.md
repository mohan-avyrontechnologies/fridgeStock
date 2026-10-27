# Deployment

Running FridgeStock for real: the full configuration reference, an HTTPS staging set-up for testing on phones, and the Android and iOS apps. For local development see the [README](../README.md#getting-started).

---

## Configuration reference

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

| `AI_PROVIDER` | *(empty = `gemini` in development, `anthropic` in production)* | No | Which AI provider to use: `gemini` (Google Gemini, which has a free tier for development) or `anthropic` (Claude). Anything else stops the server at startup. |
| `ANTHROPIC_API_KEY` | *(empty)* | For AI with `anthropic` | Claude API key. AI features are on only when the chosen provider's key is set. **Put it in `server/.env` only**, which is git-ignored. |
| `GEMINI_API_KEY` | *(empty)* | For AI with `gemini` | Google Gemini API key (official `@google/genai` SDK). **Put it in `server/.env` only.** |
| `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART` | *(empty = `gemini-2.5-flash`, `gemini-2.5-pro`)* | No | The fast model reads dates and receipts; the smart one names food in a photo and writes recipe and meal-plan ideas. Check the defaults against Google's models page before relying on them. |
| `GEMINI_TIER` | *(empty = free)* | No | Set to `paid` once the Gemini key is on a paid plan. Any other value counts as a free-tier key, and **the server prints a warning at startup if one is used in production**, because Google may use free-tier prompts (including photos) to improve its products. |
| `PHOTO_CHECK` | *(empty = off)* | No | Set to `on` to turn on Photo Check. It also needs the AI key for the chosen provider; with either missing no photo controls are shown. |
| `ANTHROPIC_BASE_URL` | *(empty = Anthropic)* | No | Read by the Anthropic SDK. Only the end-to-end tests set it, to a local stand-in. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | *(empty)* | For the apps | A Firebase **service account**. Push to the Android and iOS apps is on only when all three are set. The private key is one line with `\n` in place of line breaks. |
| `APNS_BUNDLE_ID` | *(empty)* | No | The iOS app's bundle id (your app ID), sent as the APNs topic. |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | *(empty)* | No | Not read by the server: they record the Apple key you uploaded to the Firebase console (see [Native apps](#native-apps-android-and-ios)). |
| `PUBLIC_API_URL` | *(empty)* | For Android buttons | Where the API is reached from outside (`https://<api>/api`). The **Used** and **Snooze** buttons on Android notifications call it. |
| `PRODUCT_LOOKUP_URL` | *(empty = Open Food Facts)* | No | Where barcodes are looked up. Only the end-to-end tests change it, to a local stand-in. |
| `AI_MODEL` | *(empty = `claude-sonnet-5-5`)* | No | Claude model ID. The default was checked against Anthropic's models overview on 2026-09-30. |

**Switching AI provider.** Both providers sit behind the same `AiClient` interface, return the same zod-validated JSON, and go through the same banned-wording retry, so switching is a settings change. A rate limit (HTTP 429, a quota error, or an overloaded provider) is retried once after a short pause; if it happens again the person sees "AI is busy, try again later." and the request does not count toward the 20 a day. **Every feature works without AI:** barcode look-up, reading the date on a pack (on the device, or typed), automatic expiry estimation, manual entry, plain-text meal reminders and the FridgeStock list; only recipe ideas, meal-plan suggestions, receipt reading, Photo Check and the AI date reader need a model. To compare providers before choosing one for production, run `npm run eval:ai -w server -- --provider both` against a sample set (see `server/scripts/ai-eval.ts` and `server/scripts/ai-eval/samples.example.json`): it reports accuracy per task, valid-answer rate, banned-wording hits, latency, tokens and cost (from a `prices.json` you fill in).

Generate the VAPID key pair once with `npm run vapid:keys -w server`. Push is switched on only when all three VAPID variables are set; without them, reminders stay in-app and Settings says push isn't set up. **Tests never use a real AI key:** the server ignores `ANTHROPIC_API_KEY` when `NODE_ENV` is `test`, and the end-to-end API is started with it empty.

In production the server **refuses to start** if `MONGO_URI` or `JWT_SECRET` is missing.

### `client/.env`

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | Full address of the API, for example `https://fridgestock-api.onrender.com/api` |

`.env.example` files are committed for both. The real `.env` files are git-ignored.

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
4. **Connect** → *Drivers* → copy the `mongodb+srv://…` string and put a database name before the `?`, for example `…mongodb.net/fridgestock-staging?retryWrites=true&w=majority`.

### 2. Generate the push keys (optional, for reminders)
```bash
npm run vapid:keys -w server     # prints a public and a private key
```

### 3. The API on Render
New → **Blueprint** → pick this repository. Then set these in the dashboard (`JWT_SECRET` is generated for you):

| Variable | Value |
|---|---|
| `MONGO_URI` | The Atlas string from step 1 |
| `CLIENT_ORIGIN` | Your Vercel address, **exactly** (for example `https://fridgestock.vercel.app`, no trailing slash). Fill it in after step 4. |
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
It checks HTTPS, the API's health, that CORS allows your web app (and nobody else), the security headers, whether push is set up, and that the web app, manifest, service worker, icons and deep links are served. Fix anything marked FAIL before using a phone. Then create an account on the site. To get sample food on staging, run `API_URL=https://<your-service>.onrender.com/api npm run seed -w server` (it makes the demo account described in [Scripts](../README.md#scripts); remove it before sharing the address).

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

### Debug APK from GitHub Actions
The **Android debug APK** workflow (`.github/workflows/android-apk.yml`) builds `app-debug.apk` on every push to `main`, every `v*` tag, or by hand (*Run workflow*). Download it from the run's **Artifacts** (`fridgestock-debug-apk`, kept 30 days). Set the repository variable `NATIVE_API_URL` (`https://<api>/api`) first, or the app is built to talk to `localhost`. Add the secret `GOOGLE_SERVICES_JSON` (the file's contents) for push. A debug APK is signed with a throwaway debug key: fine for testing, not for the Play Store.

### 1. Choose the app ID
`com.example.fridgestock` is a **placeholder**. Choose your own (for example `com.yourcompany.fridgestock`) **before publishing**: once an app is in the Play Store or App Store its ID can't change.
```bash
npm run native:set-app-id -w client -- com.yourcompany.fridgestock
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

**What the permission boxes say.** iPhone: *"FridgeStock uses the camera to scan barcodes and to take photos so it can identify your food. Photos are saved privately to your household and are never shared."* and, for the photo library, *"…lets you choose a photo of your food from your library so it can be identified. The photo is saved privately to your household and is never shared."* Android shows its own permission box; the same explanation is in `strings.xml` (`camera_permission_message`) and in the manifest.
