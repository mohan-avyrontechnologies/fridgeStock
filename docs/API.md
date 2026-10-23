# API reference

Base URL: `http://localhost:4000/api` (`VITE_API_URL`). Requests and responses are JSON. Every route needs `Authorization: Bearer <token>` except four: `GET /health`, `POST /auth/register`, `POST /auth/login`, and `POST /push/actions` (which carries a notification's own action token in its body instead). The auth middleware attaches the user's ID, time zone and reminder preferences to the request. It returns **401** if the token is missing, invalid or expired, or if the user no longer exists. Types are in `shared/src/api.ts`, and request schemas in `shared/src/schemas.ts`.

Every request body, query string and path value other than `:id` is checked with one of those zod schemas. An `:id` that is malformed, missing or another household's gives the same **404**, so ids reveal nothing.

**Responses:**
- **Users:** `{id, name, email, timeZone, notificationPreferences}`
- **Food items:** their stored fields (`id, name, quantity, unit, addedDate, lifespanDays, expiryDate, expirySource, estimateExplanation, printedDate, printedDateType, notes, storage, openedDate, leftover, price, photoAt, status, closedAt, createdAt, updatedAt`) plus `remainingDays` and `urgency`. For a closed item, both are `null`.

The table lists **every route the server registers (68)**, in the order of `server/src/routes/index.ts`. A test (`structure.test.ts`) fails if a route is added, removed or renamed without updating it.

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/health` | | `{ok: true}`. No login. | |
| POST | `/auth/register` | `{name, email, password (8+), timeZone}` | `201 {token, user}`. No login. | 400, 409 email taken, 429 |
| POST | `/auth/login` | `{email, password}` | `200 {token, user}`. No login. | 400, 401 "Email or password is incorrect.", 429 |
| POST | `/push/actions` | `{token, action: "USED" \| "SNOOZE" \| "SNOOZE_MEAL"}`. **No login token:** called by the service worker or the app with the notification's action token. Each notification gets its own token, which works for **24 hours** and carries out **one action, once**. A food token can only do USED or SNOOZE on its one item; a meal token can only do SNOOZE_MEAL on its one meal and day. | `204`. USED = "Used all"; SNOOZE = out of push reminders until tomorrow. SNOOZE_MEAL = remind again in 30 minutes. If the action fails, the token can be used again. Clients treat any failure, a 401 included, as "open the item": a 401 here is about the action token, never the login, so it must not sign anyone out. | 400, 401 bad, expired or already-used token ("This notification button has already been used."), 404, 409 already closed, 429 |
| GET | `/auth/me` | | `{user}` | 401 |
| PUT | `/auth/me` | any of `{name?, timeZone?, currency?, savePhotos?, firstRunDone?}` (`firstRunDone`: the first-run guide was seen; new accounts start `false`, older accounts count as done) | `{user}` | 400 |
| GET | `/account/export` | | The whole account as a JSON download. Never includes the password hash, push keys or the push service's own delivery errors. | 401 |
| DELETE | `/account` | `{password}` | `204`; the account and everything it owns are deleted | 400 wrong password, 401, 429 |
| GET | `/household` | | `{members, invites, maxMembers}` | 401 |
| POST | `/household/invites` | | `201 {code, expiresAt, createdBy}` | 409 full or too many open invites |
| DELETE | `/household/invites/:code` | the code may be written with a dash, spaces or lower case | `204` | 400 not a possible code, 404 |
| POST | `/household/join` | `{code}` | `{members, invites, maxMembers}` | 400 invalid or out-of-date code, or your own, 409 already shared or full, 429 |
| POST | `/household/leave` | | `{members, invites, maxMembers}` for your new household | 409 not shared |
| GET | `/household/activity` | `?limit=20&offset=0` | `{items, hasMore}`, newest first | 400 |
| GET | `/foods` | | `{today, summary, items}`: active items in priority order; `summary` has a count for each urgency state plus `total` | 401 |
| POST | `/foods` | `{name, quantity, unit, addedDate?, lifespanDays?, printedDate?, printedDateType?, category?, notes?, storage?, openedDate?, leftover?, price?}`. Without `lifespanDays` the expected expiry is **estimated** (see [Architecture](ARCHITECTURE.md#automatic-expiry-pipeline)); with it, the source is `USER`. `addedDate` defaults to today. | `201 FoodItem`, with reminders scheduled | 400 |
| POST | `/foods/bulk` | `{addedDate, storage?, items: [{name, quantity, unit, lifespanDays?, storage?, notes?, price?, printedDate?, printedDateType?, category?}]}` (1–50); rows without `lifespanDays` are estimated | `201 {items}`. All or nothing; errors name the row, e.g. `items.2.name` | 400 |
| GET | `/foods/cook-first` | | `{today, items}`: urgent items only. Registered before `/foods/:id`. | 401 |
| GET | `/foods/:id` | | `FoodItem`, active or closed | 404 if missing or another household's |
| PUT | `/foods/:id` | any food fields | `FoodItem`. Changing `addedDate` or `lifespanDays` recalculates `expiryDate` and reschedules reminders. | 400, 404, 409 |
| DELETE | `/foods/:id` | | `204`: soft-deleted as `REMOVED` | 404, 409 |
| POST | `/foods/:id/use` | `{quantity?}` | `{food, usageRecord}`: no quantity (or all of it) → `USED`; less → `PARTIALLY_USED` | 400 for 0, negative or too much; 404; 409 |
| POST | `/foods/:id/waste` | | `{food, usageRecord}`: closed as `WASTED` | 404, 409 |
| POST | `/foods/:id/undo` | | `FoodItem`: the item's most recent action is reversed and its usage record deleted (within 10 minutes) | 404, 409 |
| POST | `/foods/:id/use-today` | | `FoodItem` due today (lifespan shortened; reminders rescheduled) | 404, 409 closed, or already due or overdue (it can never move later) |
| POST | `/foods/:id/photo` | multipart form, one file in the field `photo` (JPEG, PNG or WebP, up to 5 MB) | the `FoodItem` with `photoAt` set; replaces any earlier photo | 400 wrong type or unreadable, 404, 409 item closed or photos turned off, 413 over 5 MB, 429 |
| GET | `/foods/:id/photo` | `?size=thumb\|full` (default `full`), `v=` (the photo's version, for caching) | the WebP, `Cache-Control: private`, `X-Content-Type-Options: nosniff` | 400, 401, 404 (no photo, or not your household's) |
| DELETE | `/foods/:id/photo` | | `204` | 404 |
| POST | `/foods/:id/open` | `{openedDate?, daysLeft?}` (date defaults to today; days default to the reference list) | `FoodItem` with `openedDate` set; expected expiry shortened if sooner; reminders rescheduled | 400 (`daysLeft` needed, bad date), 404, 409 already opened or closed |
| DELETE | `/foods/:id/open` | | `FoodItem` with the lifespan and expiry from before it was opened | 404, 409 not opened |
| POST | `/foods/:id/move` | `{storage, daysLeft?}` (days default to the reference lifespan there) | `FoodItem` with the new `storage`; expected expiry = today + days | 400 (same place, `daysLeft` needed), 404, 409 |
| GET | `/suggestions/lifespans` | | `{items: [{name, storage, unit, days, basedOn}]}`: your median lifespan per food and location | 401 |
| GET | `/favourites` | | `{items}` in name order | 401 |
| POST | `/favourites` | `{name, quantity, unit, lifespanDays, storage?}` | `201 Favourite` | 400, 409 name already a favourite |
| DELETE | `/favourites/:id` | | `204` | 404 (also for another user's favourite) |
| POST | `/favourites/:id/add` | | `201 FoodItem` added today | 404 |
| GET | `/usage` | `?limit=20&offset=0` (defaults) | `{items, total, counts}`, newest first | 400 |
| GET | `/insights` | | `{today, thisWeek, lastWeek, last30Days, weeks[8], topWasted[≤5], tips[]}` | 401 |
| GET | `/notifications` | `?limit=50&offset=0` (defaults; max 50) | Sends due reminders, then `{items, total, unread}`: `SENT` or `FAILED`, newest first | 400, 401 |
| GET | `/notifications/unread-count` | | `{unread}` (the bell badge); sends due reminders first | 401 |
| GET | `/notifications/preferences` | | `{approachingExpiry, due, overdue}` | 401 |
| PUT | `/notifications/preferences` | `{approachingExpiry?, due?, overdue?}` | preferences; pending reminders of any turned-off type are deleted | 400 |
| POST | `/notifications/read-all` | | `204`: all marked as read | 401 |
| GET | `/notifications/alerts` | | `{sound, vibration, quietHours: {enabled, start, end}}` | 401 |
| PUT | `/notifications/alerts` | any of `{sound?, vibration?, quietHours?: {enabled?, start?: "HH:mm", end?: "HH:mm"}}` | the settings | 400 (bad time, equal start and end) |
| GET | `/notifications/meals` | | `{breakfast, lunch, dinner}`, each `{enabled, time}` | 401 |
| PUT | `/notifications/meals` | any of `{breakfast?, lunch?, dinner?}`, each `{enabled?, time?: "HH:mm"}` | the settings | 400 |
| GET | `/notifications/delivery` | | `{mode, hour}` | 401 |
| PUT | `/notifications/delivery` | `{mode?: "DIGEST" \| "EACH_ITEM", hour?: 0–23}` | `{mode, hour}` | 400 |
| GET | `/push/config` | | `{publicKey, native}`: the VAPID public key (or `null`), and whether push to the apps is set up | 401 |
| POST | `/push/subscriptions` | A browser: `{endpoint (https), keys: {p256dh, auth}, browser?, platform?: 'web'}`. An app: `{platform: 'android' \| 'ios', token (the Firebase device token), browser?}` | `201 {id, platform, browser, createdAt, lastUsedAt}`. An app's token moves to whoever is signed in on that phone. | 400 |
| DELETE | `/push/subscriptions` | `{endpoint}` for a browser, `{token}` for an app | `204` (only your own) | 400 |
| GET | `/ai/status` | | `{enabled, photoCheck, dailyLimit, usedToday}` (`photoCheck` is true only when the flag and AI are both on) | 401 |
| POST | `/ai/recipes` | `{mealType?: "breakfast" \| "lunch" \| "dinner"}` (kept for the day for that meal's reminder) | `{basedOn, recipes: [{title, minutes, uses: [{id, name}], steps}]}`. Empty without asking the AI when Cook First is empty. | 429 daily limit, 503 AI off or no valid answer after 3 attempts |
| POST | `/ai/meal-plan` | | `{days: [{date, title, foods}]}` for empty days only. Not saved. | 429, 503 |
| GET | `/products/barcode` | `?code=` (8, 12, 13 or 14 digits with a correct check digit; spaces and dashes are dropped) | `{found, barcode, name, brand, quantity, unit}`; `found: false` when it isn't in the database | 400, 429, 503 look-up unavailable |
| POST | `/parse/receipt` | `{mediaType: image/jpeg\|png\|webp, image: base64}` (up to about 3 MB; with `/parse/photo`, the only routes that accept a large body) | `{purchaseDate, items: [{name, quantity, unit, price}]}`: a draft, nothing saved | 400, 429, 503 AI off or no usable answer |
| POST | `/parse/photo` | `{mediaType, image, foodId?}` (a photo as for receipts; `foodId` when it is of an item at home) | `{name, category, confidence, warningSigns: [{type, description}]}`. Changes nothing. | 400, 404 not your household's item, 429, 503 off or no usable answer |
| POST | `/parse/date` | `{mediaType, image, locale?}` (a photo of the date on a pack, as for receipts; `locale` such as `en-GB` decides day/month order) | `{text, printedDate, printedDateType}`: the text as printed, the date the server read from it (or `null` if unreadable or out of range), and what it is called. Nothing is saved. Uses the **fast** model; counts toward the daily allowance. | 400, 429, 503 AI off, busy or no usable answer |
| GET | `/shopping` | | `{items}`: to buy first, then bought; each with `atHome` matches | 401 |
| POST | `/shopping` | `{name, quantity?, unit?}` | `201 ShoppingItem` with `atHome` | 400 |
| POST | `/shopping/clear-checked` | | `204`: bought items removed | 401 |
| PUT | `/shopping/:id` | `{name?, quantity?, unit?, checked?}` | `ShoppingItem` | 400, 404 |
| DELETE | `/shopping/:id` | | `204` | 404 |
| GET | `/meal-plan` | | `{today, days: [{date, entry (the dinner) \| null, meals: {breakfast?, lunch?, dinner?}}]}` for 7 days; each entry is `{meal, title, foods: [{id, name, status}]}` | 401 |
| GET | `/meal-reminders/:meal` | `:meal` is `breakfast`, `lunch` or `dinner` | what today's reminder for that meal said: `{meal, date, content: {source: "plan" \| "recipe" \| "items", …}}` | 400 unknown meal, 401, 404 none sent today |
| PUT | `/meal-plan/:date` | `:date` is `YYYY-MM-DD`; body `{meal?: "breakfast" \| "lunch" \| "dinner" (default dinner), title, foodIds?}` | the entry | 400 (not a real date, date outside the week, not your household's food) |
| DELETE | `/meal-plan/:date` | `?meal=` (default dinner) | `204` | 400 not a real date or unknown meal, 401 |

**Errors** always look like this, and never include a stack trace:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Lifespan must be a whole number of days from 0 to 365.", "field": "lifespanDays" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid input (includes `field`). A database-level validation error is also a 400, never a 500. So is a body that isn't valid JSON, or whose compression is corrupt ("The request body couldn't be read."). |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired token; deleted user; wrong email or password; a notification action token that is expired or already used |
| 404 | `NOT_FOUND` | Item doesn't exist *or belongs to another household* (another user, for favourites); also an unknown route |
| 409 | `CONFLICT` | Email already registered; "This item is no longer active." |
| 413 | `VALIDATION_ERROR` | A request body over the size limit (20 KB; about 4.5 MB for a receipt or Photo Check photo), or a product photo over 5 MB: "That request is too large." / "That photo is too large (5 MB at most)." |
| 415 | `VALIDATION_ERROR` | A body sent with a `Content-Encoding` the server doesn't support ("The request body couldn't be read.") |
| 429 | `RATE_LIMITED` | Too many requests. Per IP address, every 15 minutes: 20 to register, log in, join a household or delete an account; 60 notification button taps; 60 barcode, receipt, photo or date reads; 60 product photo uploads. Per user: 20 AI requests a day (recipes, meal plan, receipts, Photo Check, date reading). |
| 503 | `AI_UNAVAILABLE` | AI is off, gave no usable answer after 3 attempts, or is rate-limited ("AI is busy, try again later.") |
| 503 | `SERVICE_UNAVAILABLE` | The product database can't be reached (barcode look-up); the message tells the person to type the name. |
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
