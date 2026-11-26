import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from './backup'
import { catalogDefaults, copyExercises, newSet, type Backup, type CatalogEntry, type Measurement, type Session } from './model'

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

  updateSession(date: string, update: (session: Session) => void, create = false) {
    return this.db.transaction('rw', this.db.sessions, async () => {
      const existing = await this.db.sessions.get({ date })
      if ((!existing || existing.deleted) && !create) return
      const session = existing ?? { id: crypto.randomUUID(), date, revision: 0, deleted: false, exercises: [] }
      session.deleted = false
      update(session)
      session.revision++
      await this.db.sessions.put(session)
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

  addExercise(date: string, entry: CatalogEntry) {
    return this.db.transaction('rw', this.db.catalog, this.db.sessions, async () => {
      await this.db.catalog.put(entry)
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
      let updated: CatalogEntry | undefined
      await this.updateSession(date, (session) => {
        const exercise = session.exercises.find((item) => item.id === exerciseId)
        if (!exercise) return
        exercise.restSeconds = seconds
        updated = { id: exercise.exerciseKey, name: exercise.name, restSeconds: seconds }
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
        ...existing.sessions.flatMap((s) => [s.id, ...s.exercises.flatMap((e) => [e.id, ...e.sets.map((set) => set.id)])]),
      ])
      const sessions = incoming.sessions.filter((s) => !dates.has(s.date) && !ids.has(s.id)
        && s.exercises.every((e) => !ids.has(e.id) && e.sets.every((set) => !ids.has(set.id))))
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
