import { exerciseMeasurementType } from './catalog'

export type MeasurementType = 'weight-reps' | 'reps' | 'duration' | 'unilateral-weight-reps'

export interface SetEntry {
  id: string
  weightKg: number | null
  reps: number | null
  completed: boolean
  successful?: boolean | null
  durationSeconds?: number | null
  leftWeightKg?: number | null
  rightWeightKg?: number | null
  leftReps?: number | null
  rightReps?: number | null
  restSeconds?: number | null
  failedAttemptRep?: number | null
  leftFailedAttemptRep?: number | null
  rightFailedAttemptRep?: number | null
  repsEstimated?: boolean
  leftRepsEstimated?: boolean
  rightRepsEstimated?: boolean
  durationEstimated?: boolean
  restSecondsEstimated?: boolean
  formUnstable?: boolean
  notes?: string | null
}
export interface Exercise {
  id: string
  exerciseKey: string
  name: string
  restSeconds: number | null
  measurementType?: MeasurementType
  sets: SetEntry[]
}
export interface Session {
  id: string
  date: string
  revision: number
  deleted: boolean
  exercises: Exercise[]
}
export interface Measurement {
  id: string
  date: string
  weightKg: number | null
  skeletalMuscleKg: number | null
  bodyFatKg: number | null
  bodyFatPercent: number | null
  heightCm: number | null
  notes: string | null
  revision: number
  device?: string | null
  source?: JsonValue
  measuredAtLocal?: string | null
  measurementConditions?: string | null
  missingFields?: string[] | null
  bmi?: number | null
  basalMetabolicRateKcal?: number | null
  inbodyScore?: number | null
  rightArmMuscleKg?: number | null
  leftArmMuscleKg?: number | null
  trunkMuscleKg?: number | null
  rightLegMuscleKg?: number | null
  leftLegMuscleKg?: number | null
  rightArmBodyFatKg?: number | null
  leftArmBodyFatKg?: number | null
  trunkBodyFatKg?: number | null
  rightLegBodyFatKg?: number | null
  leftLegBodyFatKg?: number | null
  waistHipRatio?: number | null
  visceralFatLevel?: number | null
  totalBodyWaterL?: number | null
  proteinKg?: number | null
  mineralKg?: number | null
  smiKgPerM2?: number | null
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface CatalogEntry {
  id: string
  name: string
  restSeconds: number
  nameEn?: string
  aliases?: string[]
  equipment?: string
  modifiers?: string[]
  measurementType?: MeasurementType
}
export interface ImportSource {
  id: string
  metadata: Record<string, JsonValue>
}
export interface Backup {
  schemaVersion: 2
  sessions: Session[]
  measurements: Measurement[]
  catalog: CatalogEntry[]
  sources: ImportSource[]
}

export function localDate(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-')
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function newSet(previous?: SetEntry): SetEntry {
  return {
    id: crypto.randomUUID(), weightKg: previous?.weightKg ?? null, reps: previous?.reps ?? null, completed: false,
    durationSeconds: previous?.durationSeconds ?? null, durationEstimated: previous?.durationEstimated ?? false,
    leftWeightKg: previous?.leftWeightKg, rightWeightKg: previous?.rightWeightKg,
    leftReps: previous?.leftReps ?? null, rightReps: previous?.rightReps ?? null,
    repsEstimated: previous?.repsEstimated ?? false, leftRepsEstimated: previous?.leftRepsEstimated ?? false,
    rightRepsEstimated: previous?.rightRepsEstimated ?? false,
  }
}

export function copyExercises(exercises: Exercise[]): Exercise[] {
  return exercises.map((exercise) => ({
    ...exercise, id: crypto.randomUUID(), sets: exercise.sets.map(newSet),
  }))
}

export function sessionRecordIds(session: Session) {
  return [session.id, ...session.exercises.flatMap((exercise) => [exercise.id, ...exercise.sets.map((set) => set.id)])]
    .map((id) => id.toLowerCase())
}

export function sideWeight(set: SetEntry, side: 'left' | 'right') {
  const weight = side === 'left' ? set.leftWeightKg : set.rightWeightKg
  return weight === undefined ? set.weightKg : weight
}

export function sessionVolumeSummary(session: Session) {
  let total = 0
  let known = false
  let partial = false
  let estimated = false
  const add = (weight: number | null, reps: number | null | undefined, approximate?: boolean) => {
    if (weight == null || reps == null) {
      partial = true
      return
    }
    total += weight * reps
    known = true
    estimated ||= approximate === true
  }
  for (const exercise of session.exercises) {
    const type = exerciseMeasurementType(exercise)
    if (type === 'duration' || type === 'reps') continue
    for (const set of exercise.sets) {
      if (!set.completed) continue
      if (type === 'unilateral-weight-reps') {
        add(sideWeight(set, 'left'), set.leftReps, set.leftRepsEstimated ?? set.repsEstimated)
        add(sideWeight(set, 'right'), set.rightReps, set.rightRepsEstimated ?? set.repsEstimated)
      } else {
        add(set.weightKg, set.reps, set.repsEstimated)
      }
    }
  }
  return { total, known, partial, estimated }
}

export function sessionVolume(session: Session) {
  return sessionVolumeSummary(session).total
}

export function remainingSeconds(endAt: number, now: number) {
  return Math.max(0, Math.ceil((endAt - now) / 1000))
}

export function periodCounts(sessions: Session[], now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const today = localDate(now)
  const visible = sessions.filter(({ deleted, date, exercises }) => !deleted && date <= today && exercises.length > 0)
  return {
    week: visible.filter(({ date }) => date >= localDate(monday)).length,
    month: visible.filter(({ date }) => date.startsWith(today.slice(0, 7))).length,
  }
}
