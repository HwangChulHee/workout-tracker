import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { parseBackup } from './backup'
import { periodCounts, remainingSeconds, sessionVolume } from './model'
import { WorkoutDatabase, WorkoutRepository } from './repository'

const date = '2026-11-26'
const databases: WorkoutDatabase[] = []
function setup(name: string = crypto.randomUUID()) {
  const db = new WorkoutDatabase(name)
  databases.push(db)
  return { db, repo: new WorkoutRepository(db) }
}
afterEach(async () => {
  for (const db of databases.splice(0).reverse()) await db.delete()
})

describe('운동 기록', () => {
  it('저장소 재연결 후에도 기록이 유지되고 연속 수정이 모두 반영된다', async () => {
    const { db, repo } = setup()
    await repo.addExercise(date, 'squat')
    const [initial] = await repo.watchSessions()
    const [exercise] = initial.exercises
    const [set] = exercise.sets
    await Promise.all([
      repo.updateSetValue(date, exercise.id, set.id, 'weightKg', 42.5),
      repo.updateSetValue(date, exercise.id, set.id, 'reps', 8),
      repo.toggleSetCompletion(date, exercise.id, set.id),
    ])
    db.close()
    const reopened = setup(db.name)
    const [session] = await reopened.repo.watchSessions()
    expect(sessionVolume(session)).toBe(340)
    expect(periodCounts([session], new Date(2026, 10, 26))).toEqual({ week: 1, month: 1 })
    await reopened.repo.copySession(session, '2026-11-27')
    const [copy] = await reopened.repo.watchSessions()
    expect(copy.exercises[0].sets[0].id).not.toBe(session.exercises[0].sets[0].id)
    expect(sessionVolume(copy)).toBe(0)
    await reopened.repo.deleteSession(date)
    expect(await reopened.repo.watchSessions()).toHaveLength(1)
  })

  it('검증된 백업을 가져오고 기존 날짜는 보호한다', async () => {
    const { repo: origin } = setup()
    const { repo } = setup()
    await origin.addExercise(date, 'squat')
    await origin.saveMeasurement({
      id: crypto.randomUUID(), date, weightKg: 72, skeletalMuscleKg: null, bodyFatKg: null,
      bodyFatPercent: null, heightCm: null, notes: null,
    })
    const backup = JSON.stringify(await origin.exportBackup())
    expect(parseBackup(backup).schemaVersion).toBe(1)
    await repo.addExercise(date, 'bench-press')
    expect(await repo.importBackup(backup)).toEqual({ added: 1, skipped: 1 })
    expect(await repo.importBackup(backup)).toEqual({ added: 0, skipped: 2 })
    expect((await repo.watchSessions())[0].exercises[0].name).toBe('벤치프레스')
    expect((await repo.watchMeasurements())[0].weightKg).toBe(72)
    const before = await repo.exportBackup()
    await expect(repo.importBackup(backup.replace(date, '2026-02-30'))).rejects.toThrow()
    await expect(repo.importBackup(backup.replace('"schemaVersion":1', '"schemaVersion":2'))).rejects.toThrow()
    expect(await repo.exportBackup()).toEqual(before)
  })

  it('타이머가 중단된 시간만큼 건너뛰고 0에서 멈춘다', () => {
    expect(remainingSeconds(90_000, 45_100)).toBe(45)
    expect(remainingSeconds(90_000, 120_000)).toBe(0)
  })

  it('백업의 모델 외 필드는 가져오기나 재내보내기에 섞이지 않는다', async () => {
    const { repo: source } = setup()
    const { repo: target } = setup()
    await source.addExercise(date, 'squat')
    const original = await source.exportBackup()
    const [session] = original.sessions
    const [exercise] = session.exercises
    const [set] = exercise.sets
    const augmented = {
      ...original,
      sessions: [{
        ...session, location: '외부 메타데이터',
        exercises: [{ ...exercise, sets: [{ ...set, unexpected: true }] }],
      }],
    }
    await target.importBackup(JSON.stringify(augmented))
    expect(await target.exportBackup()).toEqual(original)
  })

  it('휴식 설정을 이후에 추가하는 같은 운동의 기본값으로 저장한다', async () => {
    const { repo } = setup()
    await repo.addExercise(date, 'squat')
    const [session] = await repo.watchSessions()
    const secondDate = '2026-11-27'
    await Promise.all([
      repo.updateRestDefault(date, session.exercises[0].id, 75),
      repo.addExercise(secondDate, 'squat'),
    ])
    const records = await repo.readRecords()
    expect(records.sessions.map((item) => item.exercises[0].restSeconds)).toEqual([75, 75])
    expect(records.catalog.find((entry) => entry.id === 'squat')?.restSeconds).toBe(75)
  })

  it('연속 완료 토글은 저장된 상태에서 계산하고 삭제된 세트는 타이머를 시작하지 않는다', async () => {
    const { repo } = setup()
    await repo.addExercise(date, 'squat')
    const [session] = await repo.watchSessions()
    const [exercise] = session.exercises
    const [set] = exercise.sets
    const toggled = await Promise.all([
      repo.toggleSetCompletion(date, exercise.id, set.id),
      repo.toggleSetCompletion(date, exercise.id, set.id),
    ])
    expect(toggled).toEqual([180, undefined])
    expect((await repo.watchSessions())[0].exercises[0].sets[0].completed).toBe(false)
    await repo.removeSet(date, exercise.id, set.id)
    expect(await repo.toggleSetCompletion(date, exercise.id, set.id)).toBeUndefined()
  })
})
