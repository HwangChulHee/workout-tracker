import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { parseBackup } from './backup'
import { officialCatalog, resolveExerciseName, searchExercises } from './catalog'
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
    await repo.addExercise(date, 'barbell-back-squat')
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
    await origin.addExercise(date, 'barbell-back-squat')
    await origin.saveMeasurement({
      id: crypto.randomUUID(), date, weightKg: 72, skeletalMuscleKg: null, bodyFatKg: null,
      bodyFatPercent: null, heightCm: null, notes: null,
    })
    const backup = JSON.stringify(await origin.exportBackup())
    expect(parseBackup(backup).schemaVersion).toBe(2)
    await repo.addExercise(date, 'barbell-bench-press')
    expect(await repo.importBackup(backup)).toEqual({ added: 1, skipped: 1 })
    expect(await repo.importBackup(backup)).toEqual({ added: 0, skipped: 2 })
    expect((await repo.watchSessions())[0].exercises[0].name).toBe('바벨 벤치프레스')
    expect((await repo.watchMeasurements())[0].weightKg).toBe(72)
    const before = await repo.exportBackup()
    await expect(repo.importBackup(backup.replace(date, '2026-02-30'))).rejects.toThrow()
    await expect(repo.importBackup(backup.replace('"schemaVersion":2', '"schemaVersion":3'))).rejects.toThrow()
    expect(await repo.exportBackup()).toEqual(before)
  })

  it('타이머가 중단된 시간만큼 건너뛰고 0에서 멈춘다', () => {
    expect(remainingSeconds(90_000, 45_100)).toBe(45)
    expect(remainingSeconds(90_000, 120_000)).toBe(0)
  })

  it('백업의 원본 확장 필드는 다시 내보낼 때 유지된다', async () => {
    const { repo: source } = setup()
    const { repo: target } = setup()
    await source.addExercise(date, 'barbell-back-squat')
    const original = await source.exportBackup()
    const [session] = original.sessions
    const [exercise] = session.exercises
    const [set] = exercise.sets
    const augmented = {
      ...original,
      sessions: [{
        ...session, originalLabel: '외부 메타데이터',
        exercises: [{ ...exercise, sets: [{ ...set, unexpected: true }] }],
      }],
    }
    await target.importBackup(JSON.stringify(augmented))
    expect(await target.exportBackup()).toEqual(augmented)
  })

  it('휴식 설정을 이후에 추가하는 같은 운동의 기본값으로 저장한다', async () => {
    const { repo } = setup()
    await repo.addExercise(date, 'barbell-back-squat')
    const [session] = await repo.watchSessions()
    const secondDate = '2026-11-27'
    await Promise.all([
      repo.updateRestDefault(date, session.exercises[0].id, 75),
      repo.addExercise(secondDate, 'barbell-back-squat'),
    ])
    const records = await repo.readRecords()
    expect(records.sessions.map((item) => item.exercises[0].restSeconds)).toEqual([75, 75])
    expect(records.catalog.find((entry) => entry.id === 'barbell-back-squat')?.restSeconds).toBe(75)
  })

  it('연속 완료 토글은 저장된 상태에서 계산하고 삭제된 세트는 타이머를 시작하지 않는다', async () => {
    const { repo } = setup()
    await repo.addExercise(date, 'barbell-back-squat')
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

describe('공식 운동 카탈로그', () => {
  it('한국어와 영어 별칭을 같은 안정 키로 찾고 변형을 구분한다', () => {
    const names = {
      '체프': 'machine-chest-press',
      'Dead Hang': 'dead-hang',
      '철봉 매달리기': 'dead-hang',
      '바벨 백스쿼트': 'barbell-back-squat',
      '스미스 스쿼트': 'smith-machine-squat',
      '맨몸 턱걸이': 'bodyweight-pull-up',
      '밴드 풀업': 'band-assisted-pull-up',
      '가슴 패드 로우': 'chest-supported-horizontal-row',
      '시티드 케이블 로우': 'seated-cable-row',
      '바벨 밀리터리프레스': 'barbell-overhead-press',
      '머신 숄더프레스': 'machine-shoulder-press',
    }
    for (const [name, key] of Object.entries(names)) {
      expect(resolveExerciseName(name)).toEqual({ status: 'matched', key })
    }
    for (const name of ['로우', '풀업', '숄더프레스', '스쿼트', '사레레']) {
      expect(resolveExerciseName(name)).toEqual({ status: 'ambiguous' })
    }
    expect(searchExercises(officialCatalog, '풀업').map((entry) => entry.id))
      .toEqual(['band-assisted-pull-up', 'bodyweight-pull-up'])
    expect(resolveExerciseName('낯선 기구')).toEqual({ status: 'unknown' })
  })

  it('같은 동작의 별칭을 별도 사용자 종목으로 만들지 않는다', async () => {
    const { repo } = setup()
    await repo.addExercise(date, { name: '데드행', restSeconds: 90 })
    await expect(repo.addExercise(date, { name: '숄더프레스', restSeconds: 90 })).rejects.toThrow()
    await repo.addExercise(date, { name: '가상 사용자 종목', nameEn: 'Custom Hold', restSeconds: 30, measurementType: 'duration' })
    const [session] = await repo.watchSessions()
    expect(session.exercises.map(({ measurementType }) => measurementType)).toEqual(['duration', 'duration'])
    expect(session.exercises[0].exerciseKey).toBe('dead-hang')
    expect((await repo.exportBackup()).catalog).toHaveLength(1)
  })

  it('이전 IndexedDB에서 기록 ID와 모호한 종목 키를 보존하고 명시적 선택으로만 바꾼다', async () => {
    const legacy = new Dexie(crypto.randomUUID())
    legacy.version(1).stores({ sessions: 'id,&date', measurements: 'id,date', catalog: 'id' })
    const id = crypto.randomUUID()
    const exerciseId = crypto.randomUUID()
    const setId = crypto.randomUUID()
    try {
      await legacy.table('sessions').add({
        id, date, revision: 2, deleted: false, exercises: [{ id: exerciseId,
          exerciseKey: 'squat', name: '스쿼트', restSeconds: 125,
          sets: [{ id: setId, weightKg: 20, reps: 3, completed: true }] }],
      })
      await legacy.table('catalog').bulkAdd([
        { id: 'squat', name: '스쿼트', restSeconds: 125 },
        { id: 'lat-pulldown', name: '랫풀다운', restSeconds: 87 },
        { id: crypto.randomUUID(), name: '가상 사용자 항목', restSeconds: 70 },
      ])
    } finally {
      legacy.close()
    }
    const { repo } = setup(legacy.name)
    const before = await repo.readRecords()
    expect(before.sessions[0]).toMatchObject({ id, revision: 2, exercises: [{ exerciseKey: 'squat', sets: [{ id: setId }] }] })
    expect(before.catalog.find((entry) => entry.id === 'squat')).toBeUndefined()
    expect(before.catalog.find((entry) => entry.id === 'lat-pulldown')?.restSeconds).toBe(87)
    expect(before.catalog.some((entry) => entry.name === '가상 사용자 항목')).toBe(true)
    await repo.assignExerciseKey(date, exerciseId, 'smith-machine-squat')
    const [session] = await repo.watchSessions()
    expect(session.exercises[0]).toMatchObject({ id: exerciseId, exerciseKey: 'smith-machine-squat',
      restSeconds: 125, sets: [{ id: setId }] })
    expect(sessionVolume(session)).toBe(60)

    const exported = await repo.exportBackup()
    const { repo: restored } = setup()
    await restored.importBackup(JSON.stringify({
      schemaVersion: 1, sessions: exported.sessions, measurements: [], catalog: exported.catalog,
    }))
    expect(await restored.watchSessions()).toEqual(exported.sessions)
  })
})

describe('확장 JSON 교환', () => {
  it('월별 운동에서 시간, 추정, 좌우 성공 횟수와 실패 위치를 보존한다', async () => {
    const { db, repo } = setup()
    const setId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const exercise = (exerciseKey: string, name: string, set: object) => ({
      id: crypto.randomUUID(), exerciseKey, name, sets: [{ id: crypto.randomUUID(), ...set }],
    })
    const monthly = {
      schemaVersion: 1, month: '2024-03', tombstones: [{ id: crypto.randomUUID(), revision: 2 }],
      sessions: [{
        id: sessionId, date: '2024-03-12',
        exercises: [
          exercise('dead-hang', '매달리기', { id: setId, durationSeconds: 27.5, durationEstimated: true,
            restSeconds: 68, restSecondsEstimated: true, notes: '가상 메모' }),
          exercise('single-arm-cable-lateral-raise', '한팔 레이즈', {
            leftWeightKg: 5, leftReps: 9, leftFailedAttemptRep: 10, leftRepsEstimated: true,
            rightWeightKg: 6, rightReps: 7, rightFailedAttemptRep: 8, formUnstable: true,
          }),
          exercise('barbell-bench-press', '벤치', { weightKg: 30, reps: 7, failedAttemptRep: 8, successful: false }),
        ],
      }],
    }
    expect(await repo.importBackup(JSON.stringify(monthly))).toEqual({ added: 1, skipped: 0 })
    expect(await repo.importBackup(JSON.stringify(monthly))).toEqual({ added: 0, skipped: 1 })
    db.close()
    const { repo: reopened } = setup(db.name)
    const [session] = await reopened.watchSessions()
    expect(session.id).toBe(sessionId)
    expect(session.exercises[0].sets[0]).toMatchObject({
      id: setId, reps: null, weightKg: null, durationSeconds: 27.5, durationEstimated: true, restSecondsEstimated: true,
    })
    expect(session.exercises[1].sets[0]).toMatchObject({ leftReps: 9, rightReps: 7, leftRepsEstimated: true })
    expect(session.exercises[2].sets[0].successful).toBe(false)
    expect(sessionVolume(session)).toBe(5 * 9 + 6 * 7 + 30 * 7)
    const backup = await reopened.exportBackup()
    expect(backup.sources[0].metadata.tombstones).toEqual(monthly.tombstones)
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup)
  })

  it('연별 인바디 필드와 원본 메타데이터를 가져오기, 수정, 재내보내기에서 유지한다', async () => {
    const { repo } = setup()
    const original = {
      id: crypto.randomUUID(), date: '2024-03-12', weightKg: 68, bodyFatKg: 11, rightArmMuscleKg: 3.1,
      leftLegBodyFatKg: 0, bmi: 22, basalMetabolicRateKcal: 1480, smiKgPerM2: 7.1,
      device: '가상 측정기', source: { report: 'synthetic.csv' }, measuredAtLocal: '2024-03-12T09:00:00',
      missingFields: ['heightCm'], additionalMetrics: { syntheticReading: 12 },
    }
    const body = { schemaVersion: 1, year: 2024, measurements: [original], tombstones: [] }
    expect(await repo.importBackup(JSON.stringify(body))).toEqual({ added: 1, skipped: 0 })
    const [measurement] = await repo.watchMeasurements()
    expect(measurement.heightCm).toBeNull()
    await repo.saveMeasurement({ ...measurement, measurementConditions: '가상 조건', weightKg: 69 })
    const backup = await repo.exportBackup()
    expect(backup.measurements[0]).toMatchObject({ ...original, weightKg: 69, revision: 2, measurementConditions: '가상 조건' })
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup)
    expect(await repo.importBackup(JSON.stringify({ ...body,
      measurements: [{ ...original, id: crypto.randomUUID() }],
    }))).toEqual({ added: 0, skipped: 1 })
    await expect(repo.importBackup(JSON.stringify({ ...body, year: 2025 }))).rejects.toThrow()
    await expect(repo.importBackup(JSON.stringify({ ...body, measurements: [original, original] }))).rejects.toThrow()
    expect(await repo.exportBackup()).toEqual(backup)
  })
})
