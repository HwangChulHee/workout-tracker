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
