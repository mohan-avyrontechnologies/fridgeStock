# FridgeStock documentation

| Document | What's in it |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, tech stack, data model, dates, priority engine and reminders, the **automatic expiry pipeline**, **AI model routing**, project rules, security |
| [API.md](API.md) | Every endpoint with its body, response and errors; error format; validation messages |
| [FEATURES.md](FEATURES.md) | Every feature, and every screen |
| [ROADMAP.md](ROADMAP.md) | Project status, finished and planned phases, the Photo Check specification, the MVP build phases |
| [TESTING.md](TESTING.md) | What each test suite covers, and where each testing requirement is met |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Configuration reference, HTTPS staging, the Android and iOS apps (including the CI debug APK) |
| [specs/](specs/README.md) | The original specifications (BRD v2.0, FRD v1.0, SRD v1.0, TDD v1.0) and where the app deliberately differs from them |
| [screenshots/](screenshots/) | Screenshots from the Playwright suite, used in the README |
| [../CHANGELOG.md](../CHANGELOG.md) | Every release, newest first |

## Specifications

- [BRD v2.0: Business Requirements](specs/README.md)
- [FRD v1.0: Functional Requirements](specs/README.md)
- [SRD v1.0: System Requirements](specs/README.md)
- [TDD v1.0: Technical Design](specs/README.md)

The specification files themselves have not been added yet; see [specs/README.md](specs/README.md).

## Keeping the docs up to date

Every change should update the docs in the same commit (or the commit right after it):

1. Add an entry under **[Unreleased]** in [CHANGELOG.md](../CHANGELOG.md), using **Added**, **Changed**, **Fixed**, **Removed** or **Breaking**.
2. When releasing, rename **[Unreleased]** to the new version and date, bump the version in every `package.json`, and tag the release (`git tag -a vX.Y.Z`).
3. Update whatever else changed: [FEATURES.md](FEATURES.md), [API.md](API.md), [ARCHITECTURE.md](ARCHITECTURE.md), the environment variables in the README, test counts, and [ROADMAP.md](ROADMAP.md).
4. If the screens change, run `npm run test:e2e` and copy the new screenshots from `e2e/screenshots/` into `docs/screenshots/`.
