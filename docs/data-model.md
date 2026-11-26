# Data model (proposed v1)

Data is divided by update frequency: workout sessions by month, body measurements by year. Remote files are **private** in `workout-data`. No precise workout times or location.

## Proposed private repository layout
```text
workout-data/
  schema.json
  workouts/
    2026-11.json
    2026-12.json
  body/
    2026.json
```

Files are created lazily on first save. The private repository may be empty during initial UI implementation.

### workouts/2026-11.json
```json
{
  "schemaVersion": 1,
  "month": "2026-11",
  "sessions": [
    {
      "id": "session-uuid",
      "date": "2026-11-10",
      "revision": 1,
      "deleted": false,
      "exercises": [
        {
          "id": "exercise-uuid",
          "exerciseKey": "lat-pulldown",
          "name": "랫풀다운",
          "restSeconds": 90,
          "sets": [
            {
              "id": "set-uuid",
              "weightKg": 40,
              "reps": 12,
              "completed": true
            }
          ]
        }
      ]
    }
  ],
  "tombstones": []
}
```

### body/2026.json
```json
{
  "schemaVersion": 1,
  "year": 2026,
  "measurements": [
    {
      "id": "measurement-uuid",
      "date": "2026-11-10",
      "weightKg": 74.2,
      "skeletalMuscleKg": 30.1,
      "bodyFatKg": 16.8,
      "bodyFatPercent": null,
      "heightCm": null,
      "notes": null,
      "revision": 1
    }
  ],
  "tombstones": []
}
```

Values above are **fictional/example entries for schema illustration**; no body records have been written to the user's data repo.

## Model rules
- Use ISO calendar dates `YYYY-MM-DD` in local calendar time; no gym location and no remote workout start/end timestamp.
- All entities and outbox operations have stable UUIDs; the app must support editing or deleting existing records.
- A session has ordered exercises; an exercise has ordered sets. Never identify a set solely by its array index.
- Inputs are numeric, finite, within reasonable bounds and validated before storage or API calls; measurement fields are optional.
- Avoid storing derived metrics redundantly. Total volume is the sum of `weightKg * reps` for selected completed working sets; define whether warm-ups count in the UI.
- Body mass and skeletal muscle metrics may be inaccurate across InBody devices/measurement conditions; display trends and do not overinterpret short-term changes.
- Schema migrations are explicit and backward-compatible where practical. Importing a newer unsupported schema must be rejected without erasing local data.
- Conflicts: unique IDs + revisions/tombstones + base snapshots; conflicts in the same record require user resolution. A revision integer alone does not prove that one device observed another device's changes.

## Exercise ID registry and ChatGPT ingestion

See [exercise catalog](../data/exercise-catalog.json) and [GPT recording protocol](exercise-recording-protocol.md). An official exercise instance uses the catalog `exercises[].id` as `exerciseKey`. Custom catalog keys and historical legacy keys can also appear. Workout, exercise instance, and set IDs remain separate UUIDs. The catalog is versioned independently of workout data.

## InBody CSV import / extended measurement contract

The private `workout-data/body/YYYY.json` supports the core fields shown above **plus optional device-specific measurements**. A real InBody 370S CSV may contain multiple historical rows; always use the date encoded in each measurement row, **not** the CSV filename's date. For example, `InBody-20261126.csv` imported measurements dated November 5, 14 and 22, 2026; it contains no November 26 measurement.

Optional fields already found in private data: `device`, `source`, `measuredAtLocal`, `bmi`, `basalMetabolicRateKcal`, `inbodyScore`, `rightArmMuscleKg`, `leftArmMuscleKg`, `trunkMuscleKg`, `rightLegMuscleKg`, `leftLegMuscleKg`, `rightArmBodyFatKg`, `leftArmBodyFatKg`, `trunkBodyFatKg`, `rightLegBodyFatKg`, `leftLegBodyFatKg`, `waistHipRatio`, `visceralFatLevel`, `totalBodyWaterL`, `proteinKg`, `mineralKg`, `smiKgPerM2`, and `missingFields` (names of CSV measurements unavailable/marked '-'). Do not infer unreported values; preserve numeric zero when actually reported. `measuredAtLocal` is a naive timestamp transcribed from the measurement source, not a globally comparable UTC instant.

The app models these fields and preserves additional per-record JSON fields on import, edit, and export. A missing core metric becomes `null`. A missing optional metric may remain omitted. The app sorts and charts by `date` and retains `measuredAtLocal` as source information. Use `measurementConditions` for the local condition note.

## Extended sets and local backups

- `measurementType` controls set entry. The supported types are `weight-reps`, `reps`, `duration`, and `unilateral-weight-reps`.
- `completed` means an attempt is recorded. Optional `successful` describes its result. A monthly source set with omitted `completed` is treated as recorded. Missing weight and reps become `null`.
- `reps`, `leftReps`, and `rightReps` hold successful counts. `failedAttemptRep`, `leftFailedAttemptRep`, and `rightFailedAttemptRep` mark failed positions separately. The volume uses completed sets with a recorded weight and successful count for each side. An explicit side weight of `null` indicates a missing value. If the side weight was omitted, the shared `weightKg` can apply.
- `durationSeconds`, `restSeconds`, `repsEstimated`, side-specific repetition estimate flags, `durationEstimated`, `restSecondsEstimated`, `formUnstable`, and `notes` keep source details separate from derived totals.
- Dexie v2 adds storage for source-file metadata. Existing tables and record IDs are retained. App backup v2 contains `sessions`, `measurements`, `catalog`, and `sources`. The importer accepts app backup v1 and the documented monthly and yearly v1 containers. Source metadata includes the original period and any tombstones. Tombstones are retained for round-tripping and have no deletion effect during local import.
- Import validates before an additive transaction. It skips workout dates and IDs already present. Measurements are also matched by date and local measurement time when available, or by date, device, and measurements when time is missing. The local export is usable as a pre-import backup.
