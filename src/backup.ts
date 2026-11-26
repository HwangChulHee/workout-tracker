import { isDate, sessionRecordIds, type Backup, type JsonValue } from './model'
import { coreBodyMetrics, detailedBodyMetrics, segmentMetrics } from './bodyMetrics'

type Row = Record<string, unknown>
const record = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const key = (value: unknown) => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value)
const num = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const int = (value: unknown, min: number, max: number) => num(value, min, max) && Number.isInteger(value)
const flag = (value: unknown) => typeof value === 'boolean'
const textField = (value: unknown) => typeof value === 'string' && value.length <= 10000
const optional = (value: unknown, validate: (value: unknown) => boolean) => value == null || validate(value)
const strings = (value: unknown) => Array.isArray(value) && value.every(textField)
const type = (value: unknown) => typeof value === 'string'
  && ['weight-reps', 'reps', 'duration', 'unilateral-weight-reps'].includes(value)
const revision = (value: unknown) => int(value, 1, Number.MAX_SAFE_INTEGER - 1)

function rows(value: unknown, field: string, validate: (row: Row) => boolean): value is Row[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<unknown>()
  return value.every((item: unknown) => {
    if (!record(item) || seen.has(item[field]) || !validate(item)) return false
    seen.add(item[field])
    return true
  })
}

const measurementMetrics = [...coreBodyMetrics, ...detailedBodyMetrics, ...segmentMetrics]
const setFlags = ['repsEstimated', 'durationEstimated', 'restSecondsEstimated', 'leftRepsEstimated',
  'rightRepsEstimated', 'formUnstable', 'successful']
const setReps = ['reps', 'leftReps', 'rightReps', 'failedAttemptRep', 'leftFailedAttemptRep', 'rightFailedAttemptRep']

function validSet(set: Row) {
  return uuid(set.id) && optional(set.completed, flag) && optional(set.notes, textField)
    && setFlags.every((field) => optional(set[field], flag))
    && setReps.every((field) => optional(set[field], (value) => int(value, field.includes('Attempt') ? 1 : 0, 1000)))
    && ['weightKg', 'leftWeightKg', 'rightWeightKg'].every((field) => optional(set[field], (value) => num(value, 0, 2000)))
    && optional(set.durationSeconds, (value) => num(value, 0, 86400))
    && optional(set.restSeconds, (value) => num(value, 0, 86400))
}

function validMeasurement(item: Row) {
  return uuid(item.id) && isDate(item.date) && optional(item.revision, revision)
    && measurementMetrics.every(({ key, max }) => optional(item[key], (value) => num(value, 0, max)))
    && ['notes', 'device', 'measuredAtLocal', 'measurementConditions'].every((field) => optional(item[field], textField))
    && optional(item.missingFields, strings)
}

function validExercise(exercise: Row) {
  return uuid(exercise.id) && key(exercise.exerciseKey) && str(exercise.name, 120)
    && optional(exercise.restSeconds, (value) => int(value, 1, 3600))
    && optional(exercise.measurementType, type) && rows(exercise.sets, 'id', validSet)
}

function validSession(session: Row) {
  return uuid(session.id) && isDate(session.date) && optional(session.revision, revision)
    && optional(session.deleted, flag) && rows(session.exercises, 'id', validExercise)
}

function validCatalog(item: Row) {
  return key(item.id) && str(item.name, 120) && int(item.restSeconds, 1, 3600)
    && optional(item.measurementType, type) && optional(item.nameEn, textField) && optional(item.equipment, textField)
    && optional(item.aliases, strings) && optional(item.modifiers, strings)
}

function isJson(value: unknown): value is JsonValue {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  if (record(value)) return Object.values(value).every(isJson)
  return value === null || typeof value === 'string' || typeof value === 'boolean'
}

function loadJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('올바른 JSON 파일을 선택해 주세요.')
  }
}

export function parseBackup(text: string): Backup {
  const data = loadJson(text)
  if (!record(data) || (data.schemaVersion !== 1 && data.schemaVersion !== 2)) {
    throw new Error('지원하지 않는 JSON 버전입니다.')
  }
  if (!isJson(data)) throw new Error('유효하지 않은 JSON 값이 있습니다.')

  const monthly = 'month' in data
  const yearly = 'year' in data
  const invalidPeriod = (monthly && yearly) || ((monthly || yearly) && data.schemaVersion !== 1)
  if (invalidPeriod) throw new Error('지원하지 않는 월별 또는 연별 파일입니다.')

  const sessions = yearly ? [] : data.sessions
  const measurements = monthly ? [] : data.measurements
  const catalog = monthly || yearly ? [] : data.catalog
  const sources = data.schemaVersion === 2 ? data.sources : []
  if (!rows(sessions, 'date', validSession) || !rows(measurements, 'id', validMeasurement)
    || !rows(catalog, 'id', validCatalog) || !rows(sources, 'id', (item) => str(item.id, 120) && record(item.metadata))) {
    throw new Error('파일에 잘못되거나 중복된 기록이 있습니다.')
  }
  if (monthly && (typeof data.month !== 'string' || !isDate(data.month + '-01')
      || sessions.some((session) => String(session.date).slice(0, 7) !== data.month))) {
    throw new Error('운동 날짜가 파일의 월과 일치하지 않습니다.')
  }
  if (yearly && (!int(data.year, 1, 9999)
      || measurements.some((item) => Number(String(item.date).slice(0, 4)) !== data.year))) {
    throw new Error('측정 날짜가 파일의 연도와 일치하지 않습니다.')
  }

  const normalized = {
    schemaVersion: 2,
    sessions: sessions.map((session) => ({
      ...session, revision: session.revision ?? 1, deleted: session.deleted ?? false,
      exercises: (session.exercises as Row[]).map((exercise) => ({
        ...exercise, restSeconds: exercise.restSeconds ?? null,
        sets: (exercise.sets as Row[]).map((set) => ({
          ...set, weightKg: set.weightKg ?? null, reps: set.reps ?? null,
          completed: set.completed ?? monthly,
        })),
      })),
    })),
    measurements: measurements.map((item) => ({
      ...item,
      ...Object.fromEntries(coreBodyMetrics.map(({ key }) => [key, item[key] ?? null])),
      notes: item.notes ?? null, revision: item.revision ?? 1,
    })),
    catalog,
    sources: [...sources],
  } as unknown as Backup

  if (monthly || yearly) {
    const metadata = { ...data }
    delete metadata.sessions
    delete metadata.measurements
    normalized.sources.push({
      id: monthly ? 'workouts/' + data.month : 'body/' + data.year,
      metadata,
    })
  }
  const ids = [...normalized.sessions.flatMap(sessionRecordIds), ...normalized.measurements.map((item) => item.id.toLowerCase())]
  if (new Set(ids).size !== ids.length) throw new Error('파일에 중복된 식별자가 있습니다.')
  return normalized
}
