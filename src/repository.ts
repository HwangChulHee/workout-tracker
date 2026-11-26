import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from './backup'
import { catalogDefaults, copyExercises, newSet, sessionRecordIds, type Backup, type CatalogEntry, type Exercise, type Measurement, type Session, type SetEntry } from './model'

export class WorkoutDatabase extends Dexie {
  sessions!: EntityTable<Session, 'id'>
  measurements!: EntityTable<Measurement, 'id'>
  catalog!: EntityTable<CatalogEntry, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({ sessions: 'id,&date', measurements: 'id,date', catalog: 'id' })
    this.on('populate', () => this.catalog.bulkAdd(catalogDefaults))
  }
}

export class WorkoutRepository {
  constructor(private readonly db: WorkoutDatabase) {}

  watchSessions = async () => (await this.db.sessions.orderBy('date').reverse().toArray()).filter((s) => !s.deleted)
  watchMeasurements = () => this.db.measurements.orderBy('date').reverse().toArray()
  watchCatalog = () => this.db.catalog.toArray()

  readRecords() {
    return this.db.transaction('r', this.db.sessions, this.db.measurements, this.db.catalog, async () => ({
      sessions: await this.watchSessions(),
      measurements: await this.watchMeasurements(),
      catalog: await this.watchCatalog(),
    }))
  }

  private updateSession<T>(date: string, update: (session: Session) => T, create = false) {
    return this.db.transaction('rw', this.db.sessions, async () => {
      const existing = await this.db.sessions.get({ date })
      if ((!existing || existing.deleted) && !create) return
      const session = existing ?? { id: crypto.randomUUID(), date, revision: 0, deleted: false, exercises: [] }
      session.deleted = false
      const result = update(session)
      session.revision++
      await this.db.sessions.put(session)
      return result
    })
  }

  private updateExercise<T>(date: string, exerciseId: string, update: (exercise: Exercise) => T) {
    return this.updateSession(date, (session) => {
      const exercise = session.exercises.find((item) => item.id === exerciseId)
      if (exercise) return update(exercise)
    })
  }

  private updateSet<T>(date: string, exerciseId: string, setId: string, update: (set: SetEntry, exercise: Exercise) => T) {
    return this.updateExercise(date, exerciseId, (exercise) => {
      const set = exercise.sets.find((item) => item.id === setId)
      if (set) return update(set, exercise)
    })
  }

  renameExercise(date: string, exerciseId: string, name: string) {
    return this.updateExercise(date, exerciseId, (exercise) => { exercise.name = name })
  }

  removeExercise(date: string, exerciseId: string) {
    return this.updateSession(date, (session) => {
      session.exercises = session.exercises.filter((exercise) => exercise.id !== exerciseId)
    })
  }

  addSet(date: string, exerciseId: string) {
    return this.updateExercise(date, exerciseId, (exercise) => {
      exercise.sets.push(newSet(exercise.sets.at(-1)))
    })
  }

  removeSet(date: string, exerciseId: string, setId: string) {
    return this.updateExercise(date, exerciseId, (exercise) => {
      exercise.sets = exercise.sets.filter((set) => set.id !== setId)
    })
  }

  updateSetValue(date: string, exerciseId: string, setId: string, field: 'weightKg' | 'reps', value: number) {
    return this.updateSet(date, exerciseId, setId, (set) => { set[field] = value })
  }

  toggleSetCompletion(date: string, exerciseId: string, setId: string) {
    return this.updateSet(date, exerciseId, setId, (set, exercise) => {
      set.completed = !set.completed
      return set.completed ? exercise.restSeconds : undefined
    })
  }

  deleteSession(date: string) {
    return this.updateSession(date, (session) => {
      session.deleted = true
      session.exercises = []
    })
  }

  copySession(source: Session, date: string) {
    return this.updateSession(date, (target) => {
      target.exercises.push(...copyExercises(source.exercises))
    }, true)
  }

  addExercise(date: string, selection: string | Pick<CatalogEntry, 'name' | 'restSeconds'>) {
    return this.db.transaction('rw', this.db.catalog, this.db.sessions, async () => {
      const entry = typeof selection === 'string'
        ? await this.db.catalog.get(selection)
        : { id: crypto.randomUUID(), ...selection }
      if (!entry) throw new Error('종목 목록을 새로 불러온 뒤 다시 선택해 주세요.')
      if (typeof selection !== 'string') await this.db.catalog.add(entry)
      await this.updateSession(date, (session) => {
        session.exercises.push({
          id: crypto.randomUUID(), exerciseKey: entry.id, name: entry.name,
          restSeconds: entry.restSeconds, sets: [newSet()],
        })
      }, true)
    })
  }

  updateRestDefault(date: string, exerciseId: string, seconds: number) {
    return this.db.transaction('rw', this.db.catalog, this.db.sessions, async () => {
      const updated = await this.updateExercise(date, exerciseId, (exercise) => {
        exercise.restSeconds = seconds
        return { id: exercise.exerciseKey, name: exercise.name, restSeconds: seconds }
      })
      if (!updated) return
      const current = await this.db.catalog.get(updated.id)
      await this.db.catalog.put({ ...updated, name: current?.name ?? updated.name })
    })
  }

  saveMeasurement(measurement: Omit<Measurement, 'revision'>) {
    return this.db.transaction('rw', this.db.measurements, async () => {
      const current = await this.db.measurements.get(measurement.id)
      await this.db.measurements.put({ ...measurement, revision: (current?.revision ?? 0) + 1 })
    })
  }

  deleteMeasurement(id: string) {
    return this.db.measurements.delete(id)
  }

  async exportBackup(): Promise<Backup> {
    return this.db.transaction('r', this.db.sessions, this.db.measurements, this.db.catalog, async () => ({
      schemaVersion: 1,
      sessions: await this.db.sessions.toArray(),
      measurements: await this.db.measurements.toArray(),
      catalog: await this.db.catalog.toArray(),
    }))
  }

  async importBackup(text: string) {
    const incoming = parseBackup(text)
    return this.db.transaction('rw', this.db.sessions, this.db.measurements, this.db.catalog, async () => {
      const existing = await this.exportBackup()
      const dates = new Set(existing.sessions.map((s) => s.date))
      const ids = new Set([
        ...existing.measurements.map((m) => m.id),
        ...existing.sessions.flatMap(sessionRecordIds),
      ])
      const sessions = incoming.sessions.filter((s) => !dates.has(s.date)
        && sessionRecordIds(s).every((id) => !ids.has(id)))
      const measurements = incoming.measurements.filter((m) => !ids.has(m.id))
      const keys = new Set(existing.catalog.map((c) => c.id))
      await this.db.sessions.bulkAdd(sessions)
      await this.db.measurements.bulkAdd(measurements)
      await this.db.catalog.bulkAdd(incoming.catalog.filter((c) => !keys.has(c.id)))
      return {
        added: sessions.length + measurements.length,
        skipped: incoming.sessions.length + incoming.measurements.length - sessions.length - measurements.length,
      }
    })
  }
}

export const repository = new WorkoutRepository(new WorkoutDatabase('workout-tracker'))
