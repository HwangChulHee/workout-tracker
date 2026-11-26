# Workout Tracker

A mobile-first, installable workout log for tracking strength training, rest intervals, and body-composition trends.

> **Status:** Phase 1 is implemented. The app stores workout and body records locally and can run offline after its first successful load. GitHub sync and the Pages deployment workflow are future phases.

## Repositories

| Repository | Visibility | Purpose |
| --- | --- | --- |
| [workout-tracker](https://github.com/HwangChulHee/workout-tracker) | Public | React PWA source, documentation, GitHub Pages |
| [workout-data](https://github.com/HwangChulHee/workout-data) | Private | Personal workout and body-composition JSON |

The app shell is public. Phase 1 stores personal records in IndexedDB on the device. The planned remote sync will require a user-supplied, narrowly scoped GitHub fine-grained personal access token (PAT). The token must never be committed, bundled into frontend code, included in URLs, or placed in GitHub Actions secrets for this design.

## Core features

- Workout sessions organized by calendar date (no gym location or precise visit time collected)
- Korean/English exercise catalog search, including aliases, equipment, and movement variations. Set entry supports weight and reps, duration, and left/right tracking.
- Rest countdown with vibration on supported Android devices (best-effort only while active)
- Previous-session recall and quick set duplication
- Workout history and trends (frequency, sets, volume, exercise progress)
- InBody records and trends with device, measurement conditions, and optional segmental readings
- Offline-first local saving and JSON export/import. Manual and automatic GitHub sync are planned.

## Technology

React, TypeScript, Vite, Tailwind CSS, Dexie, Lucide React, Recharts, Vitest, and a PWA service worker. The deployment plan uses GitHub Pages without an always-on server or database service. The intended operating cost is 0 KRW/month within free-tier limits.

```text
Galaxy / desktop browser
    ├── React PWA + IndexedDB (offline-first)
    ├── locally entered GitHub fine-grained PAT
    └── HTTPS → GitHub REST API → workout-data (PRIVATE)

GitHub Pages ← built static assets from workout-tracker (PUBLIC)
```

## Development plan

1. **UI & local data:** responsive mobile-first screens, exercises/sets, rest timer, Dexie, demo mode
2. **Private GitHub integration:** PAT entry/validation, read/write JSON, minimal repository permissions
3. **Offline synchronization:** pending operations, SHA preconditions, conflict detection/merge and retries
4. **PWA & deployment:** install/offline shell, GitHub Actions → Pages, Android testing
5. **Statistics & polish:** exercise trends, body composition charts, backup/import/export

See [architecture](docs/architecture.md), [data model](docs/data-model.md), and [implementation roadmap](docs/roadmap.md).

## Exercise code registry

- [Versioned exercise catalog](data/exercise-catalog.json): 16 stable exercise IDs, Korean/English names, safe aliases, equipment, target muscles and measurement types. Existing 2026-11-26 workout-data keys are preserved.
- [GPT workout recording protocol](docs/exercise-recording-protocol.md): instructions for matching conversation wording to an exercise code, preserving unknown or estimated values, and safely committing to the private data repository.
- **Integration pending:** the Phase 1 React app currently still uses its preliminary hardcoded catalog in `src/model.ts`. Codex needs to integrate the JSON registry and update types for durations, unilateral sets and uncertain repetitions before the GitHub sync phase. These documents alone do not change UI behavior.


## Security and privacy

- The public website **is not access restricted**. Without a valid PAT, visitors cannot read private workout-data content.
- PAT entry is manual per device. Persisting the token is optional and carries XSS/device-compromise risk; there is no truly secret browser storage.
- Fine-grained PAT: only `workout-data`, repository Contents read/write; no broad scopes. Token expiration and replacement must be supported.
- No personal records, PATs, GitHub API responses, or secrets in Pages build output, analytics, browser logs, sample fixtures, or public repo.
- Avoid third-party scripts; apply a restrictive Content Security Policy where compatible.
- Private data should not be moved into the public repo even as a sample.

## Getting started

Run the app from WSL using Node.js 22 and npm.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

Open the URL printed by Vite under `/workout-tracker/`. Use the production preview to test the service worker. Load the app once online so it can cache the app shell. Installation on a phone requires a supported browser and an HTTPS origin.

Use **설정** to export a JSON backup before importing, clearing browser data, or switching devices. The importer accepts app backups (v1/v2), monthly workout JSON, and yearly InBody JSON. It validates the whole file before writing and skips conflicts with existing records. The demo uses a separate database.

Each date has one workout session. Copying a workout adds exercises and sets with fresh IDs and resets completion. The weekly counter starts on Monday. Volume counts successful reps from completed sets with known weights, including each side separately. Estimates remain flagged in the set details.

The [official exercise catalog](data/exercise-catalog.json) supplies stable keys and default rest times. Historical generic codes remain on existing records until you confirm a specific variant under **이전 종목 코드 확인**. Existing custom entries and rest preferences remain in IndexedDB.

The build uses the GitHub Pages base path `/workout-tracker/`. Pages deployment remains in Phase 4.

## Design principles

Keep it simple, local-first and resilient to temporary network failure. Treat GitHub as a small versioned JSON store—not a transactional database. Avoid extra infrastructure until the use case requires it.
