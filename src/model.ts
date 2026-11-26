export interface SetEntry {
  id: string
  weightKg: number
  reps: number
  completed: boolean
}
export interface Exercise {
  id: string
  exerciseKey: string
  name: string
  restSeconds: number
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
}
export interface CatalogEntry {
  id: string
  name: string
  restSeconds: number
}
export interface Backup {
  schemaVersion: 1
  sessions: Session[]
  measurements: Measurement[]
  catalog: CatalogEntry[]
}

export const catalogDefaults: CatalogEntry[] = [
  { id: 'bench-press', name: '벤치프레스', restSeconds: 120 },
  { id: 'squat', name: '스쿼트', restSeconds: 180 },
  { id: 'deadlift', name: '데드리프트', restSeconds: 180 },
  { id: 'lat-pulldown', name: '랫풀다운', restSeconds: 90 },
  { id: 'overhead-press', name: '숄더프레스', restSeconds: 90 },
  { id: 'seated-row', name: '시티드 로우', restSeconds: 90 },
]

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
  return { id: crypto.randomUUID(), weightKg: previous?.weightKg ?? 0, reps: previous?.reps ?? 0, completed: false }
}

export function copyExercises(exercises: Exercise[]): Exercise[] {
  return exercises.map((exercise) => ({
    ...exercise, id: crypto.randomUUID(), sets: exercise.sets.map(newSet),
  }))
}

export function sessionRecordIds(session: Session) {
  return [session.id, ...session.exercises.flatMap((exercise) => [exercise.id, ...exercise.sets.map((set) => set.id)])]
}

export function sessionVolume(session: Session) {
  return session.exercises.flatMap((exercise) => exercise.sets)
    .reduce((volume, set) => volume + (set.completed ? set.weightKg * set.reps : 0), 0)
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
