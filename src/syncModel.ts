import { parseBackup } from './backup'
import type { JsonValue, Measurement, Session } from './model'

export type SyncRecord = Session | Measurement
export type Bucket = { records: SyncRecord[]; metadata: Record<string, JsonValue> }
export type PendingWrite = { local: SyncRecord[]; target: Bucket }
export type SyncState = { id: string; base: Bucket | null; pending?: PendingWrite }
export type Choice = 'local' | 'remote'
export interface Conflict {
  path: string
  signature: string
  local: unknown
  remote: unknown
  resolvable: boolean
  reason?: string
}
export type Decisions = Record<string, { signature: string; choice: Choice }>
export class SyncRecordCollision extends Error {}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => same(value, b[index]))
  if (object(a) && object(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => same(a[key], b[key]))
  }
  return false
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const workoutBucket = (path: string) => path.startsWith('workouts/')
export const recordKey = (path: string, row: SyncRecord) => workoutBucket(path) ? row.date : row.id.toLowerCase()

export function emptyBucket(path: string): Bucket {
  const period = path.split('/')[1].slice(0, -5)
  return { records: [], metadata: { schemaVersion: 1,
    ...(workoutBucket(path) ? { month: period } : { year: Number(period) }), tombstones: [] } }
}

export function readBucket(path: string, text: string): Bucket {
  const parsed = parseBackup(text)
  const source = parsed.sources.find((item) => item.id + '.json' === path)
  const isMonthly = workoutBucket(path)
  if (!source || (isMonthly ? parsed.measurements.length : parsed.sessions.length)) {
    throw new Error('원격 파일의 경로와 기록 기간이 일치하지 않아요.')
  }
  // Require a period file even if a v2 backup embeds matching source metadata.
  const root: unknown = JSON.parse(text)
  const expected = emptyBucket(path).metadata
  if (!object(root) || root.schemaVersion !== 1
    || (isMonthly ? root.month !== expected.month : root.year !== expected.year)) {
    throw new Error('원격 파일의 형식을 확인해 주세요.')
  }
  const tombstones = source.metadata.tombstones
  if (tombstones != null && (!Array.isArray(tombstones)
    || tombstones.some((item) => !object(item) || typeof item.id !== 'string' || !item.id))) {
    throw new Error('원격 삭제 표식을 읽을 수 없어요.')
  }
  const records = isMonthly ? parsed.sessions : parsed.measurements
  const marked = new Set(rows(tombstones)?.map((row) => String(row.id).toLowerCase()))
  if (records.some((row) => !inactive(row) && marked.has(row.id.toLowerCase()))) {
    throw new Error('같은 ID가 활성 기록과 삭제 표식에 함께 있어 동기화를 중단했어요.')
  }
  return { records, metadata: source.metadata }
}

export function writeBucket(path: string, bucket: Bucket) {
  return JSON.stringify({ ...bucket.metadata, [workoutBucket(path) ? 'sessions' : 'measurements']: bucket.records }, null, 2) + '\n'
}

function choose(path: string, local: unknown, remote: unknown, decisions: Decisions, conflicts: Conflict[]) {
  const signature = JSON.stringify([local === undefined, local, remote === undefined, remote])
  const decision = Object.hasOwn(decisions, path) ? decisions[path] : undefined
  if (decision?.signature === signature) return decision.choice === 'local' ? local : remote
  conflicts.push({ path, signature, local, remote, resolvable: true })
  return remote
}

const inactive = (value: unknown) => value === undefined || (object(value) && value.deleted === true)

function rows(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) && value.every((item) => object(item) && typeof item.id === 'string') ? value : undefined
}

function mergeChildren(path: string, base: unknown, local: unknown, remote: unknown, decisions: Decisions, conflicts: Conflict[]) {
  const before = rows(base) ?? []
  const left = rows(local)
  const right = rows(remote)
  if (!left || !right) return choose(path, local, remote, decisions, conflicts)
  const index = (items: typeof before) => new Map(items.map((row) => [String(row.id).toLowerCase(), row]))
  const b = index(before), l = index(left), r = index(right)
  const keys = [...new Set([...r.keys(), ...l.keys()])]
  return keys.flatMap((key) => {
    const merged = mergeValue(path + '/' + key, b.get(key), l.get(key), r.get(key), decisions, conflicts)
    return merged === undefined ? [] : [merged]
  })
}

function mergeValue(path: string, base: unknown, local: unknown, remote: unknown, decisions: Decisions, conflicts: Conflict[]): unknown {
  if (same(local, remote) || same(remote, base)) return local
  if (same(local, base)) return remote
  if (object(base) && object(local) && object(remote)) {
    if ((local.deleted === true) !== (remote.deleted === true)) return choose(path, local, remote, decisions, conflicts)
    return mergeObject(path, base, local, remote, decisions, conflicts)
  }
  return choose(path, local, remote, decisions, conflicts)
}

function mergeObject(path: string, base: Record<string, unknown>, local: Record<string, unknown>,
  remote: Record<string, unknown>, decisions: Decisions, conflicts: Conflict[]) {
  return Object.fromEntries([...new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(base)])].map((key) => {
    const field = path + '/' + encodeURIComponent(key)
    if (key === 'revision' && typeof local[key] === 'number' && typeof remote[key] === 'number') {
      return [key, Math.max(local[key], remote[key])]
    }
    if (key === 'exercises' || key === 'sets') {
      if (same(local[key], base[key])) return [key, remote[key]]
      if (same(remote[key], base[key])) return [key, local[key]]
      return [key, mergeChildren(field, base[key], local[key], remote[key], decisions, conflicts)]
    }
    return [key, mergeValue(field, base[key], local[key], remote[key], decisions, conflicts)]
  }).filter(([, value]) => value !== undefined))
}

export function mergeRecords(path: string, base: SyncRecord[], local: SyncRecord[], remote: SyncRecord[], decisions: Decisions, conflicts: Conflict[]) {
  const index = (items: SyncRecord[]) => new Map(items.map((row) => [recordKey(path, row), row]))
  const b = index(base), l = index(local), r = index(remote)
  return [...new Set([...r.keys(), ...l.keys(), ...b.keys()])].flatMap((key) => {
    const previous = b.get(key), left = l.get(key), right = r.get(key)
    const location = path + '/' + key
    // Two independently-created workouts can have the same date. Keep the remote session UUID.
    const newlySharedDate = workoutBucket(path) && !previous && left && right && !inactive(left) && !inactive(right)
    const value = newlySharedDate
      ? mergeObject(location, {}, { ...left, id: right.id }, { ...right }, decisions, conflicts)
      : mergeValue(location, previous, left, right, decisions, conflicts)
    return value === undefined ? [] : [value as SyncRecord]
  })
}

function tombstones(bucket: Bucket) {
  return rows(bucket.metadata.tombstones) ?? []
}

export function mergeBucket(path: string, base: Bucket | null, local: SyncRecord[], remote: Bucket, decisions: Decisions, conflicts: Conflict[]): Bucket {
  // A previously synchronized row omitted by the local device is a deletion.
  const blocked = new Set(tombstones(remote).map((row) => String(row.id).toLowerCase()))
  const blockedDates = new Set(tombstones(remote).filter((row) => typeof row.date === 'string').map((row) => row.date))
  const previous = base?.records ?? []
  const remoteKeys = new Set(remote.records.map((row) => recordKey(path, row)))
  const filtered = local.filter((row) => {
    const key = recordKey(path, row)
    if (remoteKeys.has(key) || previous.some((before) => recordKey(path, before) === key)
      || (!blocked.has(row.id.toLowerCase()) && (!workoutBucket(path) || !blockedDates.has(row.date)))) return true
    if (inactive(row)) return false
    return choose(path + '/' + key, row, undefined, decisions, conflicts) !== undefined
  })
  const records = mergeRecords(path, previous, filtered, remote.records, decisions, conflicts)
  const kept = new Set(records.map((row) => recordKey(path, row)))
  const saved = new Map(tombstones(remote).map((row) => [String(row.id).toLowerCase(), row]))
  const activeIds = new Set(records.filter((row) => !inactive(row)).map((row) => row.id.toLowerCase()))
  for (const id of activeIds) saved.delete(id)
  for (const row of [...previous, ...remote.records]) {
    const id = row.id.toLowerCase()
    if (!kept.has(recordKey(path, row)) && !saved.has(id)) {
      saved.set(id, { id: row.id, date: row.date, revision: row.revision + 1 })
    }
  }
  const metadata = { ...remote.metadata }
  const nextTombstones = [...saved.values()]
  if (!same(nextTombstones, tombstones(remote))) metadata.tombstones = nextTombstones as JsonValue
  return { records, metadata }
}
