import { localDate } from './model'
import { WorkoutDatabase, WorkoutRepository } from './repository'

const db = new WorkoutDatabase('workout-tracker-demo')
export const demoRepository = new WorkoutRepository(db)

export function prepareDemo() {
  return db.transaction('rw', db.sessions, db.measurements, async () => {
    if (await db.sessions.count() || await db.measurements.count()) return
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const date = localDate(yesterday)

    await db.sessions.add({
      id: crypto.randomUUID(), date, revision: 1, deleted: false,
      exercises: [{
        id: crypto.randomUUID(), exerciseKey: 'lat-pulldown', name: '랫풀다운', restSeconds: 90,
        sets: [{ id: crypto.randomUUID(), weightKg: 35, reps: 12, completed: true }],
      }],
    })
    await db.measurements.add({
      id: crypto.randomUUID(), date, revision: 1, weightKg: 70, skeletalMuscleKg: 31,
      bodyFatKg: 14, bodyFatPercent: 20, heightCm: null, notes: '데모 측정',
    })
  })
}
