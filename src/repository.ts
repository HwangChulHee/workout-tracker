import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from './backup'
import { availableExercises, officialExercise, resolveExerciseName } from './catalog'
import { coreBodyMetrics, detailedBodyMetrics, segmentMetrics } from './bodyMetrics'
import { copyExercises, newSet, sessionRecordIds, type Backup, type CatalogEntry, type Exercise, type ImportSource, type Measurement, type Session, type SetEntry } from './model'
import { same, SyncRecordCollision, workoutBucket, type SyncRecord, type SyncState } from './syncModel'

export class WorkoutDatabase extends Dexie {
  sessions!: EntityTable<Session, 'id'>
  measurements!: EntityTable<Measurement, 'id'>
  catalog!: EntityTable<CatalogEntry, 'id'>
  sources!: EntityTable<ImportSource, 'id'>
  syncStates!: EntityTable<SyncState, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({ sessions: 'id,&date', measurements: 'id,date', catalog: 'id' })
    this.version(2).stores({ sources: 'id' })
    this.version(3).stores({ syncStates: 'id' })
  }
}

export class WorkoutRepository {
  constructor(private readonly db: WorkoutDatabase) {}

  watchSessions = async () => (await this.db.sessions.orderBy('date').reverse().toArray()).filter((s) => !s.deleted)
  watchMeasurements = () => this.db.measurements.orderBy('date').reverse().toArray()
  watchCatalog = async () => availableExercises(await this.db.catalog.toArray())

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

  updateSetValue<K extends Exclude<keyof SetEntry, 'id' | 'completed'>>(
    date: string, exerciseId: string, setId: string, field: K, value: SetEntry[K],
  ) {
    return this.updateSet(date, exerciseId, setId, (set) => { set[field] = value })
  }

  toggleSetCompletion(date: string, exerciseId: string, setId: string) {
    return this.updateSet(date, exerciseId, setId, (set, exercise) => {
      set.completed = !set.completed
      return set.completed ? exercise.restSeconds ?? officialExercise(exercise.exerciseKey)?.restSeconds : undefined
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

  addExercise(date: string, selection: string | Omit<CatalogEntry, 'id'>) {
    return this.db.transaction('rw', this.db.catalog, this.db.sessions, async () => {
      const entries = await this.watchCatalog()
      const match = typeof selection === 'string' ? { status: 'matched', key: selection } as const
        : resolveExerciseName(selection.name, entries)
      if (match.status === 'ambiguous') throw new Error('여러 종목에 해당하는 이름이에요. 장비와 수행 방식이 표시된 종목을 선택해 주세요.')
      let entry = match.status === 'matched' ? entries.find((item) => item.id === match.key) : undefined
      if (match.status === 'unknown' && typeof selection !== 'string') {
        entry = { id: crypto.randomUUID(), ...selection }
        await this.db.catalog.add(entry)
      }
      if (!entry) throw new Error('종목 목록을 새로 불러온 뒤 다시 선택해 주세요.')
      const { id, name, restSeconds, measurementType } = entry
      const previous = await this.db.sessions.where('date').below(date).reverse()
        .filter((session) => !session.deleted && session.exercises.some((exercise) => exercise.exerciseKey === id))
        .first()
      const priorSet = previous?.exercises.find((exercise) => exercise.exerciseKey === id)?.sets
        .find((set) => set.completed)
      await this.updateSession(date, (session) => {
        session.exercises.push({
          id: crypto.randomUUID(), exerciseKey: id, name, restSeconds, measurementType, sets: [newSet(priorSet)],
        })
      }, true)
    })
  }

  assignExerciseKey(date: string, exerciseId: string, key: string) {
    const entry = officialExercise(key)
    if (!entry) throw new Error('공식 카탈로그에서 종목을 선택해 주세요.')
    return this.updateExercise(date, exerciseId, (exercise) => {
      exercise.exerciseKey = entry.id
      exercise.name = entry.name
      exercise.measurementType = entry.measurementType
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
      await this.db.catalog.put({ ...current, ...updated, name: current?.name ?? updated.name })
    })
  }

  saveMeasurement(measurement: Omit<Measurement, 'revision'>) {
    return this.db.transaction('rw', this.db.measurements, async () => {
      const current = await this.db.measurements.get(measurement.id)
      await this.db.measurements.put({ ...current, ...measurement, revision: (current?.revision ?? 0) + 1 })
    })
  }

  deleteMeasurement(id: string) {
    return this.db.measurements.delete(id)
  }

  async exportBackup(): Promise<Backup> {
    return this.db.transaction('r', this.db.sessions, this.db.measurements, this.db.catalog, this.db.sources, async () => ({
      schemaVersion: 2,
      sessions: await this.db.sessions.toArray(),
      measurements: await this.db.measurements.toArray(),
      catalog: await this.db.catalog.toArray(),
      sources: await this.db.sources.toArray(),
    }))
  }

  async importBackup(text: string) {
    const incoming = parseBackup(text)
    return this.db.transaction('rw', this.db.sessions, this.db.measurements, this.db.catalog, this.db.sources, async () => {
      const existing = await this.exportBackup()
      const dates = new Set(existing.sessions.map((s) => s.date))
      const ids = new Set([
        ...existing.measurements.map((m) => m.id.toLowerCase()),
        ...existing.sessions.flatMap(sessionRecordIds),
      ])
      const sessions = incoming.sessions.filter((s) => !dates.has(s.date)
        && sessionRecordIds(s).every((id) => !ids.has(id)))
      const measurementKeys = new Set(existing.measurements.map(measurementKey))
      const measurements = incoming.measurements.filter((m) => {
        const key = measurementKey(m)
        if (ids.has(m.id.toLowerCase()) || measurementKeys.has(key)) return false
        measurementKeys.add(key)
        return true
      })
      const keys = new Set(existing.catalog.map((c) => c.id))
      await this.db.sessions.bulkAdd(sessions)
      await this.db.measurements.bulkAdd(measurements)
      await this.db.catalog.bulkAdd(incoming.catalog.filter((c) => !keys.has(c.id)))
      const sourceKeys = new Set(existing.sources.map((source) => source.id))
      await this.db.sources.bulkAdd(incoming.sources.filter((source) => !sourceKeys.has(source.id)))
      return {
        added: sessions.length + measurements.length,
        skipped: incoming.sessions.length + incoming.measurements.length - sessions.length - measurements.length,
      }
    })
  }

  async syncPaths() {
    const [sessions, measurements, states, sources] = await Promise.all([
      this.db.sessions.orderBy('date').keys(), this.db.measurements.orderBy('date').keys(),
      this.db.syncStates.toCollection().primaryKeys(), this.db.sources.toCollection().primaryKeys(),
    ])
    return [...new Set([
      ...sessions.map((date) => 'workouts/' + String(date).slice(0, 7) + '.json'),
      ...measurements.map((date) => 'body/' + String(date).slice(0, 4) + '.json'),
      ...states, ...sources.map((id) => id + '.json'),
    ])]
  }

  private syncRows(path: string): Promise<SyncRecord[]> {
    const period = path.split('/')[1].slice(0, -5)
    const table = workoutBucket(path) ? this.db.sessions : this.db.measurements
    return table.where('date').startsWith(period + '-').toArray()
  }

  readSync(path: string) {
    return this.db.transaction('r', this.db.sessions, this.db.measurements, this.db.syncStates, this.db.sources, async () => ({
      records: await this.syncRows(path),
      state: await this.db.syncStates.get(path),
      source: await this.db.sources.get(path.slice(0, -5)),
    }))
  }

  private async validateSyncRows(path: string, expected: SyncRecord[], records: SyncRecord[]) {
    const isWorkout = workoutBucket(path)
    const currentIds = new Set(expected.map((row) => row.id))
    const [sessions, measurements] = await Promise.all([this.db.sessions.toArray(), this.db.measurements.toArray()])
    const activeIds = new Set([
      ...sessions.filter((row) => !isWorkout || !currentIds.has(row.id)).flatMap(sessionRecordIds),
      ...measurements.filter((row) => isWorkout || !currentIds.has(row.id)).map((row) => row.id.toLowerCase()),
    ])
    const ids = isWorkout ? (records as Session[]).flatMap(sessionRecordIds) : records.map((row) => row.id.toLowerCase())
    if (ids.some((id) => activeIds.has(id)) || new Set(ids).size !== ids.length) {
      throw new SyncRecordCollision('다른 날짜 또는 기간에 같은 기록 ID가 있어요. 원본을 확인한 뒤 다시 동기화해 주세요.')
    }
  }

  stageSyncWrite(path: string, expected: SyncRecord[], records: SyncRecord[], state: SyncState) {
    return this.db.transaction('rw', this.db.sessions, this.db.measurements, this.db.syncStates, async () => {
      if (!same(expected, await this.syncRows(path))) return false
      await this.validateSyncRows(path, expected, records)
      await this.db.syncStates.put(state)
      return true
    })
  }

  applySync(path: string, expected: SyncRecord[], records: SyncRecord[], state: SyncState) {
    return this.db.transaction('rw', this.db.sessions, this.db.measurements, this.db.syncStates, this.db.sources, async () => {
      if (!same(expected, await this.syncRows(path))) return false
      const incomingIds = new Set(records.map((row) => row.id))
      const removed = expected.filter((row) => !incomingIds.has(row.id)).map((row) => row.id)
      await this.validateSyncRows(path, expected, records)
      if (!same(expected, records)) {
        if (workoutBucket(path)) {
          await this.db.sessions.bulkDelete(removed)
          await this.db.sessions.bulkPut(records as Session[])
        } else {
          await this.db.measurements.bulkDelete(removed)
          await this.db.measurements.bulkPut(records as Measurement[])
        }
      }
      if (state.base) await this.db.sources.put({ id: path.slice(0, -5), metadata: state.base.metadata })
      await this.db.syncStates.put(state)
      return true
    })
  }
}

function measurementKey(measurement: Measurement) {
  if (measurement.measuredAtLocal) return JSON.stringify([measurement.date, measurement.measuredAtLocal.replace(' ', 'T')])
  const metrics = [...coreBodyMetrics, ...detailedBodyMetrics, ...segmentMetrics]
  return JSON.stringify([measurement.date, measurement.device ?? null, ...metrics.map(({ key }) => measurement[key] ?? null)])
}

export const repository = new WorkoutRepository(new WorkoutDatabase('workout-tracker'))
