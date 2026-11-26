import { bucketPath, GitHubError, type RemoteStorage } from './github'
import type { WorkoutRepository } from './repository'
import { emptyBucket, mergeBucket, mergeRecords, readBucket, same, SyncRecordCollision, writeBucket, type Conflict, type Decisions } from './syncModel'

export class SyncConflict extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super('서로 다른 변경이 발견되어 해당 파일의 동기화를 중단했어요.')
  }
}

export async function synchronize(repo: WorkoutRepository, remote: RemoteStorage, decisions: Decisions = {}, signal?: AbortSignal) {
  const paths = [...new Set([...await remote.list(), ...await repo.syncPaths()])].filter(bucketPath).sort()
  const conflicts: Conflict[] = []
  const deferred: string[] = []
  async function run(path: string, retry: boolean) {
    signal?.throwIfAborted()
    try {
      await synchronizeFile(repo, remote, path, decisions, signal)
    } catch (error) {
      if (error instanceof SyncConflict) conflicts.push(...error.conflicts)
      else if (error instanceof SyncRecordCollision) {
        if (retry) conflicts.push({ path, signature: '', local: undefined, remote: undefined,
          resolvable: false, reason: error.message })
        else deferred.push(path)
      } else throw error
    }
  }
  for (const path of paths) await run(path, false)
  for (const path of deferred) await run(path, true)
  if (conflicts.length) throw new SyncConflict(conflicts)
}

async function synchronizeFile(repo: WorkoutRepository, remote: RemoteStorage, path: string, decisions: Decisions, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 5; attempt++) {
    signal?.throwIfAborted()
    const file = await remote.read(path)
    const snapshot = await repo.readSync(path)
    const { records, state, source } = snapshot
    const previous = state?.base ?? null
    const pending = state?.pending
    if (!file && previous) {
      // A whole missing file can also mean its permissions changed. Preserve local data and stop.
      throw new SyncConflict([{ path, signature: '', local: undefined, remote: undefined, resolvable: false,
        reason: '이전에 연결된 원격 파일이 없어요. GitHub에서 파일을 복원한 뒤 다시 동기화해 주세요.' }])
    }
    const incoming = file ? readBucket(path, file.text) : emptyBucket(path)
    if (!file && source) incoming.metadata = source.metadata
    const conflicts: Conflict[] = []
    if (file && pending && same(incoming, pending.target)) {
      const rebased = mergeRecords(path, pending.local, records, incoming.records, decisions, conflicts)
      if (conflicts.length) throw new SyncConflict(conflicts)
      signal?.throwIfAborted()
      const applied = await repo.applySync(path, records, rebased, { id: path, base: incoming })
      if (applied && same(rebased, incoming.records)) return
      continue
    }
    let target = mergeBucket(path, previous, records, incoming, decisions, conflicts)
    if (conflicts.length) throw new SyncConflict(conflicts)
    signal?.throwIfAborted()

    if ((file && same(target, incoming)) || (!file && !target.records.length)) {
      if (await repo.applySync(path, records, target.records, { id: path, base: file ? incoming : null })) return
      continue
    }

    const text = writeBucket(path, target)
    target = readBucket(path, text)
    if (!await repo.stageSyncWrite(path, records, target.records, { id: path, base: previous, pending: { local: records, target } })) continue
    signal?.throwIfAborted()
    try {
      await remote.write(path, text, file?.sha)
    } catch (error) {
      if (!(error instanceof GitHubError) || error.kind !== 'sha') throw error
    }
    // Read again, both after success and SHA races. The journal survives a lost response or app reload.
  }
  throw new GitHubError('원격 파일의 변경이 계속되고 있어요. 잠시 뒤 다시 동기화해 주세요.', 'sha')
}
