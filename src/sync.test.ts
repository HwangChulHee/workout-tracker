import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubError, GitHubStorage, type RemoteFile, type RemoteStorage } from './github'
import { WorkoutDatabase, WorkoutRepository } from './repository'
import { synchronize, SyncConflict } from './sync'
import { readBucket, writeBucket } from './syncModel'
import type { Session } from './model'

const path = 'workouts/2024-03.json'
const date = '2024-03-12'
const databases: WorkoutDatabase[] = []
function repository() {
  const db = new WorkoutDatabase(crypto.randomUUID())
  databases.push(db)
  return new WorkoutRepository(db)
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete()
})

class MockRemote implements RemoteStorage {
  files = new Map<string, RemoteFile>()
  writes = 0
  loseResponse = false
  race?: () => void
  offline = false

  async list() {
    if (this.offline) throw new GitHubError('offline', 'network')
    return [...this.files.keys()]
  }
  async read(path: string) { return this.files.get(path) ?? null }
  async write(path: string, text: string, sha?: string) {
    if (this.race) {
      const race = this.race
      this.race = undefined
      race()
    }
    if (this.files.get(path)?.sha !== sha) throw new GitHubError('changed', 'sha')
    this.files.set(path, { text, sha: String(++this.writes) })
    if (this.loseResponse) {
      this.loseResponse = false
      throw new GitHubError('response lost after write', 'network')
    }
  }
}

async function editWeight(repo: WorkoutRepository, kg: number) {
  const [session] = await repo.watchSessions()
  const [exercise] = session.exercises
  await repo.updateSetValue(session.date, exercise.id, exercise.sets[0].id, 'weightKg', kg)
}

describe('GitHub 동기화', () => {
  it('같은 날짜의 다른 기기 운동을 합치고, 재실행에는 쓰지 않는다', async () => {
    const a = repository()
    const b = repository()
    const remote = new MockRemote()
    await a.addExercise(date, 'barbell-back-squat')
    await b.addExercise(date, 'dead-hang')
    await synchronize(a, remote)
    const [remoteSession] = await a.watchSessions()
    await synchronize(b, remote)
    await synchronize(a, remote)
    const [merged] = await a.watchSessions()
    expect(merged.id).toBe(remoteSession.id)
    expect(merged.exercises.map((exercise) => exercise.exerciseKey)).toEqual(['barbell-back-squat', 'dead-hang'])
    expect(await b.watchSessions()).toEqual(await a.watchSessions())
    expect(remote.writes).toBe(2)
  })

  it('같은 세트 필드의 충돌에서 쓰기를 막고, 확인된 선택만 적용한다', async () => {
    const a = repository()
    const b = repository()
    const remote = new MockRemote()
    await a.addExercise(date, 'barbell-back-squat')
    await synchronize(a, remote)
    await synchronize(b, remote)
    await editWeight(a, 20)
    await editWeight(b, 25)
    await synchronize(a, remote)
    let conflict: SyncConflict | undefined
    try {
      await synchronize(b, remote)
    } catch (error) {
      if (!(error instanceof SyncConflict)) throw error
      conflict = error
    }
    expect(conflict?.conflicts).toEqual([expect.objectContaining({ local: 25, remote: 20 })])
    expect(remote.writes).toBe(2)
    const field = conflict!.conflicts[0]
    await synchronize(b, remote, { [field.path]: { signature: field.signature, choice: 'local' } })
    await synchronize(a, remote)
    expect((await a.watchSessions())[0].exercises[0].sets[0].weightKg).toBe(25)
    expect(remote.writes).toBe(3)
  })

  it('SHA 경쟁 뒤 다시 읽어 다른 세트 필드의 변경을 병합한다', async () => {
    const a = repository()
    const remote = new MockRemote()
    await a.addExercise(date, 'barbell-back-squat')
    await synchronize(a, remote)
    await editWeight(a, 32)
    remote.race = () => {
      const upstream = readBucket(path, remote.files.get(path)!.text)
      const [session] = upstream.records as Session[]
      session.exercises[0].sets[0].reps = 6
      session.revision++
      remote.files.set(path, { sha: 'other-device', text: writeBucket(path, upstream) })
    }
    await synchronize(a, remote)
    expect((await a.watchSessions())[0].exercises[0].sets[0]).toMatchObject({ weightKg: 32, reps: 6 })
  })

  it('응답이 끊긴 쓰기를 재조회해 확인하고, 그 뒤의 오프라인 수정도 보존한다', async () => {
    const a = repository()
    const remote = new MockRemote()
    await a.addExercise(date, 'barbell-back-squat')
    await synchronize(a, remote)
    await editWeight(a, 40)
    remote.loseResponse = true
    await expect(synchronize(a, remote)).rejects.toMatchObject({ kind: 'network' })
    remote.offline = true
    await editWeight(a, 45)
    await expect(synchronize(a, remote)).rejects.toMatchObject({ kind: 'network' })
    expect((await a.watchSessions())[0].exercises[0].sets[0].weightKg).toBe(45)
    remote.offline = false
    await synchronize(a, remote)
    await synchronize(a, remote)
    expect((readBucket(path, remote.files.get(path)!.text).records[0] as Session).exercises[0].sets[0].weightKg).toBe(45)
    expect(remote.writes).toBe(3)
  })

  it('다른 기기의 삭제와 수정이 충돌하면 양쪽 원본을 유지한다', async () => {
    const a = repository()
    const b = repository()
    const remote = new MockRemote()
    await a.addExercise(date, 'barbell-back-squat')
    await synchronize(a, remote)
    await synchronize(b, remote)
    await a.deleteSession(date)
    await editWeight(b, 55)
    await synchronize(a, remote)
    await expect(synchronize(b, remote)).rejects.toBeInstanceOf(SyncConflict)
    expect((await b.watchSessions())[0].exercises[0].sets[0].weightKg).toBe(55)
    expect((readBucket(path, remote.files.get(path)!.text).records[0] as Session).deleted).toBe(true)
    expect(remote.writes).toBe(2)
  })

  it('원격 파일 전체가 사라지면 로컬 기록과 원격 파일을 변경하지 않는다', async () => {
    const a = repository()
    const remote = new MockRemote()
    await a.addExercise(date, 'dead-hang')
    await synchronize(a, remote)
    remote.files.delete(path)
    await expect(synchronize(a, remote)).rejects.toMatchObject({ conflicts: [expect.objectContaining({ resolvable: false })] })
    expect(await a.watchSessions()).toHaveLength(1)
    expect(remote.writes).toBe(1)
  })

  it('인바디 삭제 표식은 새 기기의 오래된 백업이 기록을 자동 복원하는 것을 막는다', async () => {
    const a = repository()
    const old = repository()
    const remote = new MockRemote()
    const bodyPath = 'body/2024.json'
    const id = crypto.randomUUID()
    await a.saveMeasurement({ id, date, weightKg: 63, skeletalMuscleKg: null, bodyFatKg: null,
      bodyFatPercent: null, heightCm: null, notes: null, source: { synthetic: true } })
    await synchronize(a, remote)
    await old.importBackup(JSON.stringify(await a.exportBackup()))
    await a.deleteMeasurement(id)
    await synchronize(a, remote)
    const bucket = readBucket(bodyPath, remote.files.get(bodyPath)!.text)
    expect(bucket.records).toEqual([])
    expect(bucket.metadata.tombstones).toEqual([expect.objectContaining({ id })])
    await expect(synchronize(old, remote)).rejects.toBeInstanceOf(SyncConflict)
    expect((await old.watchMeasurements())[0].source).toEqual({ synthetic: true })
    expect(remote.writes).toBe(2)
  })
})

describe('GitHub REST API', () => {
  it('토큰을 헤더에만 쓰고, UTF-8 파일을 SHA 조건으로 업로드한다', async () => {
    const fake = 'synthetic-credential-for-test'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ private: true, default_branch: 'main' }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ type: 'file', sha: 'existing', encoding: 'base64', content: 'e30=' }))
      .mockResolvedValueOnce(Response.json({}, { status: 200 }))
    const storage = new GitHubStorage(fake, fetcher)
    await storage.connect()
    expect(await storage.read(path)).toEqual({ sha: 'existing', text: '{}' })
    await storage.write(path, '{"name":"가상"}', 'existing')
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain(fake)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + fake)
      expect(init?.cache).toBe('no-store')
      expect(String(init?.body ?? '')).not.toContain(fake)
    }
    const request = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))
    expect(request.sha).toBe('existing')
    expect(new TextDecoder().decode(Uint8Array.from(atob(request.content), (character) => character.charCodeAt(0))))
      .toBe('{"name":"가상"}')
  })

  it.each([
    [401, {}, 'auth'],
    [403, {}, 'permission'],
    [404, {}, 'permission'],
    [429, { 'retry-after': '12' }, 'rate'],
  ] as const)('인증, 권한, 한도 오류를 응답 본문 없이 분류한다 (%s)', async (status, headers, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private error body', { status, headers }))
    const api = new GitHubStorage('synthetic-only', fetcher)
    await expect(api.connect()).rejects.toMatchObject({ kind })
  })
})
