# Architecture & security

## Goals / non-goals
- Personal, single-user strength-training log optimized for a Galaxy phone; desktop support.
- No paid hosting, always-on backend, managed database, or third-party login.
- Source is public; workout and body-composition records are private.
- GitHub Pages hosts the *static app*, not the personal JSON.
- Do not promise reliable background vibration or uninterrupted timers while the screen is locked.

## Runtime architecture
```text
GitHub Pages (public static distribution)
       │ React/Vite PWA + service worker
       ▼
Galaxy Chrome / desktop browser
       ├── IndexedDB: workout records, measurement records, outbox, sync metadata
       ├── optional local PAT retention (explicit user opt-in)
       └── fetch HTTPS + Authorization: Bearer <PAT>
                    │
                    ▼
           GitHub REST Contents API
                    │
                    ▼
     HwangChulHee/workout-data (PRIVATE)
```

No Cloudflare, backend, private key in source, or GitHub Actions cross-repository token is needed. Check cross-origin browser API requests in a real Galaxy browser during Phase 2; browser extensions, network settings and API policies can still impact requests.

## Identity / credentials
1. On first use, show a GitHub token connection form rather than falsely claiming GitHub OAuth login.
2. User creates a **fine-grained PAT** explicitly restricted to `HwangChulHee/workout-data` with **Contents: read and write** (and automatically required metadata read permission).
3. Validate the token by a minimally scoped request against the target repo. A successful call to `/user` alone does not establish access to the private data repo.
4. Keep token in memory by default. Offer opt-in 'remember on this device'; stored tokens remain accessible to JavaScript in the same origin and are at risk from XSS, malicious extensions or compromised devices. Do not imply that encryption at rest with a key saved alongside the token solves this.
5. Provide disconnect, delete locally cached records, token expiry/rotation, and clear error states. Disconnecting locally cannot revoke a PAT; instruct users to revoke it in GitHub settings.
6. HTTPS only; never put PAT in URL, console, crash report, error text, repo, workflow or sample fixtures.
7. Limit dependencies and third-party scripts; minimize DOM injection, avoid unsafe HTML and use an appropriate CSP (prefer HTML meta CSP where response headers cannot be configured).
8. GitHub Pages is publicly reachable. UI gating is **not** site access control. Protect private records using repo permissions; never include records in the public build.
9. Avoid saving gym name, coordinates or precise workout start times; GitHub commit timestamps can still reveal sync activity.

## Local-first persistence
- Each completed input is committed to IndexedDB immediately; remote synchronization is asynchronous.
- UI distinguishes `saved locally`, `sync pending`, `synced`, `conflict`, `authentication required`.
- Persist a local outbox of immutable operations with stable operation IDs and entity UUIDs. Do not consider a remote write successful until GitHub confirms it.
- If offline or PAT is expired, preserve unsynced data and offer manual retry/export.
- Export/import JSON with schema validation. Warn before destructive local reset.
- Cache only app shell/static assets via service worker; don't service-worker-cache authenticated API responses or tokens.

## Remote storage and sync
- GitHub data stays in `workout-data`, recommended paths `workouts/YYYY-MM.json`, `body/YYYY.json`, and `schema.json`.
- GitHub Contents API GET returns a file blob SHA. When updating, supply the latest SHA in PUT; newly created files omit it. Treat 409/422 concurrency errors as reload-and-reconcile cases, not unconditional overwrite.
- For each sync: read latest remote snapshot → fold pending local operations → detect same-entity concurrent edits → create/update with SHA → acknowledge operations only on successful remote write.
- Distinct UUID operations (e.g., adding different sets) can be merged. For *same field* edits or delete-vs-edit, retain both candidates and ask user to resolve rather than using silent last-write-wins.
- Represent deletion with tombstones (id + revision/deletedAt) so an older offline client cannot resurrect a deleted record.
- Concurrent read/modify/write is **not transaction-safe** across multiple files; keep each write scoped to one file and serialize sync on each device. SHA checking helps prevent accidental blind overwrites but cannot replace a DB transaction.
- GitHub is not a real-time DB: explicit sync, occasional polling on focus, and retry/backoff. Avoid a write per timer tick, keystroke, or every screen render.
- Do not mark "synced" when only a local IndexedDB write succeeded.
- API permissions/quotas and CORS behavior should be validated in a deployed browser before committing to direct-client access.

## Timer and mobile behavior
- Store a desired end timestamp rather than relying on setInterval counts; compute `max(0, endAt - Date.now())` on foreground/resume.
- `navigator.vibrate()` may work on Galaxy/Android browsers with user activation, but is not guaranteed while backgrounded or locked. Provide visual feedback; optional sound/notification needs separate browser support assessment.
- Never store precise end timestamps in remote public metadata; timer runtime state stays local.

## Deploy
- GitHub Pages serves only Vite `dist/` artifacts from public `workout-tracker`.
- Use Vite base `/workout-tracker/` for project Pages, and verify PWA manifest scope/start_url/service-worker paths on the real URL.
- Later add GitHub Actions pages build and deployment with minimal permissions. Keep PAT and private data *out of Actions*.
- Consider access patterns: data repo remains private even if this source repo is public. Free hosting is subject to GitHub policies and limits.
