# Specifications

Cook First was built from four internal documents (the PFCP specification set):

| Document | Version | What it covers | File |
|---|---|---|---|
| **BRD**: Business Requirements Document | 2.0 | Goals, users, scope and success measures | *not added yet* |
| **FRD**: Functional Requirements Document | 1.0 | The functional requirements (FR-AUTH, FR-FOOD, FR-EXP, FR-PRI, FR-UI, FR-NOT, FR-USE, FR-VAL) referred to in the code and tests | *not added yet* |
| **SRD**: System Requirements Document | 1.0 | Non-functional and system requirements | *not added yet* |
| **TDD**: Technical Design Document | 1.0 | Architecture, data model and API design | *not added yet* |

> **To add them:** copy the four files into this folder (`docs/specs/`) and replace *not added yet* with a link to each one. They were not on the machine where v2.23.0 was prepared. The repository is private, but these are internal documents, so only add them if everyone with access may read them.

The Photo Check specification (Phase 7) is in [ROADMAP.md](../ROADMAP.md#phase-7-photo-check-specification).

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
| Reminders | **In-app only.** Firebase push is postponed. | See the [Roadmap](../ROADMAP.md#roadmap). |
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
