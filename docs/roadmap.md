# Implementation roadmap

Use the following phases as independent, verifiable Codex tasks. Documentation-only is the current state.

## Phase 1 — Mobile-first UI and local functionality
- Scaffold Vite/React/TypeScript and set the GitHub Pages base path.
- Build installable-feeling responsive screens: today's workout, history/calendar, statistics, rest timer, body measurements, settings/token connection.
- Add exercise catalog, customizable exercises, ordered sets, weight/reps, done state, rest duration, copy previous workout.
- Persist real data in IndexedDB (Dexie). Keep sample/demo records *only in explicitly marked demo mode*, never mixed into real data.
- Implement date-based session grouping and local backup JSON export/import.
- Timer uses target end timestamp; visual completion and best-effort Android vibration.
**Acceptance:** refresh/restart preserves records; offline local recording works; responsive on Galaxy-sized screens; no network/PAT needed for Phase 1.

## Phase 2 — GitHub private storage and auth
- User enters a fine-grained PAT manually; choose session-only token by default or explicitly opt-in local persistence.
- Validate repo access to HwangChulHee/workout-data and distinguish expired token, missing permission, rate limit, connectivity.
- Implement GET and conditional Contents API PUT for workout and body JSON files; verify browser CORS in production Pages.
- Show local/remote status clearly; no token in logs or artifacts.
**Acceptance:** create, read, edit and delete sample records via a token-restricted private repo using real browsers; user can disconnect without destroying unsynced records. Never test by uploading real secrets.

## Phase 3 — Reliable synchronization
- Durable local outbox, operation IDs, de-duplication, retry/backoff and online/focus-triggered sync.
- SHA-based conflict detection; refetch and merge disjoint operations; user resolution for same-field or delete-vs-edit.
- Tombstones and stale-device tests.
- Cover three cases: one device offline, two devices adding different records, two devices modifying the same record.
**Acceptance:** no silent data loss or duplicate records across defined scenarios; 'synced' displayed only when confirmed remotely.

## Phase 4 — PWA and Pages deployment
- Manifest, icons, service worker app-shell caching; no caching private API data.
- GitHub Actions build+deploy static artifacts to Pages. Confirm only public code/assets go to dist.
- Verify `/workout-tracker/` routing, install on Galaxy Chrome, refresh after install, offline launch, network reconnection.
- Test background/locked-screen timer limitations; don't promise guaranteed vibration.
**Acceptance:** GitHub Pages URL loads on mobile/desktop, installs as PWA where supported, retains local data.

## Phase 5 — Statistics, usability & hardening
- Trends: exercise performance, volume, training frequency, body weight, muscle mass and body fat.
- Accessibility, large tap targets and quick-add/edit flow for use between sets.
- Token rotation UI, restrictive CSP, input/schema validation, error handling.
- Backup/restore and repeatable test checklist.
**Acceptance:** core flows work with no lost local edits; no private info in built artifacts; README documents limitations.

## Out of scope for MVP
- Cloudflare/EC2/RDS/backend server
- Public social feed or multi-user auth
- Guaranteed background vibration or push alerts
- AI coaching, nutrition advice, health integrations
- Automatic synchronization on a fixed schedule while the app is closed

## Suggested first Codex prompt
```text
Read README.md, docs/architecture.md, docs/data-model.md, and docs/roadmap.md.
Implement Phase 1 only: Vite/React/TypeScript mobile-first PWA-like workout
tracking screens with Dexie local-first persistence, sets/weight/reps,
rest timer using an end timestamp, workout history, body metrics, and JSON
export/import. Make the demo optional and clearly labeled.
Do not introduce Cloudflare/backend or commit secrets. Do not attempt to
connect to workout-data or implement PAT authentication yet.
Include simple tests and run build/lint/test checks.
```
