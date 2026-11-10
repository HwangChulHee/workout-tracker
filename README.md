# Workout Tracker

A mobile-first, installable workout log for tracking strength training, rest intervals, and body-composition trends.

> **Status:** Planning / documentation only. The app, GitHub sync, and Pages deployment are not implemented yet.

## Repositories

| Repository | Visibility | Purpose |
| --- | --- | --- |
| [workout-tracker](https://github.com/HwangChulHee/workout-tracker) | Public | React PWA source, documentation, GitHub Pages |
| [workout-data](https://github.com/HwangChulHee/workout-data) | Private | Personal workout and body-composition JSON |

The app shell is public. **Personal records remain private**, and require a user-supplied, narrowly scoped GitHub fine-grained personal access token (PAT). The token must never be committed, bundled into frontend code, included in URLs, or placed in GitHub Actions secrets for this design.

## Core features

- Workout sessions organized by calendar date (no gym location or precise visit time collected)
- Exercise selection with sets, weight (kg), reps, completion, and rest duration
- Rest countdown with vibration on supported Android devices (best-effort only while active)
- Previous-session recall and quick set duplication
- Workout history and trends (frequency, sets, volume, exercise progress)
- Body measurements: weight, skeletal muscle mass, body fat mass/percentage and optional height
- Offline-first local saving, manual/automatic GitHub sync, and JSON export/import

## Technology

React + TypeScript + Vite; PWA with service worker; IndexedDB (Dexie); GitHub REST Contents API; GitHub Pages using Actions. **No always-on server or database service.** Intended operating cost: 0 KRW/month within free-tier limits.

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

## Security and privacy

- The public website **is not access restricted**. Without a valid PAT, visitors cannot read private workout-data content.
- PAT entry is manual per device. Persisting the token is optional and carries XSS/device-compromise risk; there is no truly secret browser storage.
- Fine-grained PAT: only `workout-data`, repository Contents read/write; no broad scopes. Token expiration and replacement must be supported.
- No personal records, PATs, GitHub API responses, or secrets in Pages build output, analytics, browser logs, sample fixtures, or public repo.
- Avoid third-party scripts; apply a restrictive Content Security Policy where compatible.
- Private data should not be moved into the public repo even as a sample.

## Getting started

No app scaffold exists yet. Start with Phase 1 in [docs/roadmap.md](docs/roadmap.md). Pages must be configured after the build workflow is implemented; **this README does not mean the app is deployed**.

## Design principles

Keep it simple, local-first and resilient to temporary network failure. Treat GitHub as a small versioned JSON store—not a transactional database. Avoid extra infrastructure until the use case requires it.
