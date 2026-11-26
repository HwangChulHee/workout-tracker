# Exercise catalog and GPT recording protocol (v1)

## Source of truth

The authoritative **public** catalog is [data/exercise-catalog.json](../data/exercise-catalog.json) in `workout-tracker`. The **private** logs live in `HwangChulHee/workout-data`, currently `workouts/YYYY-MM.json`. Read the current catalog and the target month file **on each write**. Never assume cached chat memory is more up-to-date than GitHub. The catalog's `id` is the stored workout `exerciseKey`. Do **not** treat external provider exercise numbers as universal standards.

## Conversational ingestion checklist

1. Extract explicitly stated local calendar date, exercise wording, machine/equipment, movement variation, side, weight, successful reps or hold seconds, rest interval and notes. Do not infer precise times or gym locations. If date is omitted, resolve from user timezone only when it is clear the user means today.
2. Normalize only spelling, whitespace and familiar abbreviations. Match precise `nameKo`, `nameEn`, or `aliases` to a **single** catalog entry. A match must also agree with known equipment and variation. Do not let a generic name override explicit machine/Smith/band/one-arm information.
3. For broad/ambiguous words such as `로우`, `스쿼트`, `숄더프레스`, `풀업`, check `ambiguousTerms`. Use prior user-confirmed variant **only when the context says the same exercise/machine**; otherwise ask one specific clarification. When uncertainty is not resolvable, retain original wording in a staging draft, without writing an invented key.
4. New exercise: propose a stable, descriptive ASCII kebab-case `id`; append it to the catalog first **only once variation/equipment are known**. Avoid changing existing IDs. Add aliases for chat variants, but never aliases that would collapse different physical exercises. Never repurpose an old ID.
5. Keep three identifiers distinct: `exerciseKey` = catalog stable ID; session/exercise-instance `id` = unique UUID; set `id` = unique UUID. Different dates or repeated entries of the same movement need different instance UUIDs.
6. Record only **successful** reps in `reps`. Failed attempts are metadata, e.g. `failedAttemptRep`; they are not added to volume. Differentiate `repsEstimated`, `durationEstimated`, `restSecondsEstimated`; never silently convert approximate to confirmed. Use `null` for unknown counts/weights rather than 0 or invented values.
7. Respect measurement type. `duration` → `durationSeconds` (not reps); `reps` → reps without fabricated weight; `unilateral-weight-reps` → `leftReps` and `rightReps`, with weight per arm and combined volume explicitly calculated if appropriate. For machine weight, avoid making equivalence claims across machine models.
8. User's stated session totals are cross-checks, not a license to rewrite individual sets. Calculate set count and known-volume from details; flag discrepancy. Derived e1RM and volume are **not** primary source truth.
9. On write, GET current `workouts/YYYY-MM.json`; if absent, create schemaVersion 1 monthly container. Match a pre-existing session by date and stable IDs; never duplicate the same session on retries. Preserve unrelated sessions, notes, unknown extension fields and tombstones. Apply GitHub SHA precondition, refetch and reconcile on conflict, then verify saved JSON by reading it again.
10. If a workout date already exists, treat new statements as additions/corrections and preserve existing entries unless a user explicitly wants replacement. If a correction could alter uncertain notes, store the corrected interpretation and keep a useful audit note.
11. Commit to **private data repo only**; never put real workouts, body composition, or PAT in public repo. After saving, report affected date, counts, inferred items and Git commit URL.

## Cases to distinguish

| Input | Key | Why |
| --- | --- | --- |
| `체프 머신 51kg 6회` | `machine-chest-press` | machine |
| `스미스 스쿼트 50kg` | `smith-machine-squat` | guided bar vs free bar |
| `바벨 백스쿼트 50kg` | `barbell-back-squat` | free bar |
| `밴드 풀업 5회` | `band-assisted-pull-up` | assistance specified |
| `맨몸 풀업 5회` | `bodyweight-pull-up` | no band |
| `가슴패드 수평 로우` | `chest-supported-horizontal-row` | distinct from cable row |
| `케이블 사레레 왼10 오른6` | `single-arm-cable-lateral-raise` | side-specific reps |
| `오트익 15kg 7회 정도` | `cable-overhead-triceps-extension` | context-confirmed alias, estimated reps |

## Compatibility with current React app

The existing `src/model.ts` has a **separate preliminary catalogDefaults array** with generic IDs (e.g. `squat`, `seated-row`) and numeric-only set fields. This file is **not yet integrated** with the richer catalog. During the next app implementation step:
- Load/import this JSON as the sole built-in exercise list; maintain user's custom catalog entries and migration aliases.
- Migrate ambiguous old IDs with explicit user confirmation rather than guessing `squat` → one of two squat variants.
- Extend set model/form/import validators for nullable reps/weights, duration holds, unilateral reps, estimates, failed reps and notes.
- Preserve backwards compatibility with v1 local backup and the first private GitHub workout JSON.
- Add tests for Korean aliases, ambiguous variant avoidance, stable IDs, duplicate-date writes, unknown inputs and volume math.

## Catalog evolution

Add a new entry with unique stable kebab-case `id`, Korean/English names, safe aliases, muscle/equipment classification, measurement type and default rest. Version the catalog. Old entries remain valid even if the display name changes. Remove an alias if it becomes ambiguous, not the existing ID.
