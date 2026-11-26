import { isDate, sessionRecordIds, type Backup } from './model'

type RecordValue = Record<string, unknown>
const record = (v: unknown): v is RecordValue => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, limit: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= limit
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const int = (v: unknown, min: number, max: number) => num(v, min, max) && Number.isInteger(v)
const metric = (v: unknown, max: number) => v === null || num(v, 0, max)
const catalogKey = (v: unknown) => typeof v === 'string' && /^[a-z0-9-]{1,80}$/.test(v)

function rows(v: unknown, key: string, valid: (row: RecordValue) => boolean) {
  if (!Array.isArray(v)) return false
  const seen = new Set<unknown>()
  return v.every((row: unknown) => {
    if (!record(row) || seen.has(row[key]) || !valid(row)) return false
    seen.add(row[key])
    return true
  })
}

function pick<T extends object, K extends keyof T>(row: T, ...keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) result[key] = row[key]
  return result
}

export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('올바른 JSON 파일을 선택해 주세요.')
  }
  if (!record(data) || data.schemaVersion !== 1) throw new Error('지원하지 않는 백업 버전입니다.')
  const exercise = (e: RecordValue) => uuid(e.id) && catalogKey(e.exerciseKey)
    && str(e.name, 80) && int(e.restSeconds, 1, 3600)
    && rows(e.sets, 'id', (s) => uuid(s.id) && num(s.weightKg, 0, 2000)
      && int(s.reps, 0, 1000) && typeof s.completed === 'boolean')
  if (!rows(data.sessions, 'date', (s) => uuid(s.id) && isDate(s.date)
      && int(s.revision, 1, Number.MAX_SAFE_INTEGER) && typeof s.deleted === 'boolean'
      && rows(s.exercises, 'id', exercise))
    || !rows(data.measurements, 'id', (m) => uuid(m.id) && isDate(m.date)
      && int(m.revision, 1, Number.MAX_SAFE_INTEGER) && metric(m.weightKg, 500)
      && metric(m.skeletalMuscleKg, 250) && metric(m.bodyFatKg, 500)
      && metric(m.bodyFatPercent, 100) && metric(m.heightCm, 300)
      && (m.notes === null || (typeof m.notes === 'string' && m.notes.length <= 1000)))
    || !rows(data.catalog, 'id', (c) => catalogKey(c.id) && str(c.name, 80) && int(c.restSeconds, 1, 3600))) {
    throw new Error('백업에 잘못되거나 중복된 기록이 있습니다.')
  }
  const backup = data as unknown as Backup
  const ids = [...backup.sessions.flatMap(sessionRecordIds), ...backup.measurements.map((m) => m.id)]
  if (new Set(ids).size !== ids.length) throw new Error('백업에 중복된 식별자가 있습니다.')
  return {
    schemaVersion: 1,
    sessions: backup.sessions.map((session) => ({
      ...pick(session, 'id', 'date', 'revision', 'deleted'),
      exercises: session.exercises.map((exercise) => ({
        ...pick(exercise, 'id', 'exerciseKey', 'name', 'restSeconds'),
        sets: exercise.sets.map((set) => pick(set, 'id', 'weightKg', 'reps', 'completed')),
      })),
    })),
    measurements: backup.measurements.map((measurement) => pick(measurement,
      'id', 'date', 'weightKg', 'skeletalMuscleKg', 'bodyFatKg', 'bodyFatPercent', 'heightCm', 'notes', 'revision')),
    catalog: backup.catalog.map((entry) => pick(entry, 'id', 'name', 'restSeconds')),
  }
}
