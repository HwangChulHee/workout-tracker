import { useCallback, useEffect, useRef, useState } from 'react'
import { GitHubError, GitHubStorage, tokenStorageKey } from './github'
import { synchronize, SyncConflict } from './sync'
import type { Conflict, Decisions } from './syncModel'
import type { WorkoutRepository } from './repository'

type Status = 'local' | 'pending' | 'connecting' | 'syncing' | 'synced' | 'conflict' | 'error'
const statuses: Record<Status, string> = {
  local: '기기 저장', pending: '동기화 대기', connecting: 'GitHub 연결 확인 중',
  syncing: '동기화 중', synced: '동기화 완료', conflict: '동기화 충돌', error: '동기화 오류',
}
const saveDelay = 3000

interface Connection {
  api: GitHubStorage
  controller: AbortController
  verified: boolean
  credentialsBlocked: boolean
  retryAt: number
  failures: number
  timer?: number
  queued: boolean
  decisions?: Decisions
}

function cancelTimer(connection: Connection) {
  clearTimeout(connection.timer)
  connection.timer = undefined
}

function schedule(connection: Connection, delay: number, run: () => void) {
  cancelTimer(connection)
  connection.timer = window.setTimeout(() => {
    connection.timer = undefined
    run()
  }, delay)
}

function saveToken(token: string | null) {
  try {
    if (token === null) localStorage.removeItem(tokenStorageKey)
    else localStorage.setItem(tokenStorageKey, token)
  } catch { /* The current connection can still use memory. */ }
}

const idle = { state: 'local' as Status, message: '', conflicts: [] as Conflict[], lastSync: undefined as number | undefined }

export function useGitHubSync(repo: WorkoutRepository) {
  const connection = useRef<Connection>(null)
  const running = useRef<Connection>(null)
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState(idle)

  const stop = useCallback(() => {
    const current = connection.current
    connection.current = null
    if (!current) return
    cancelTimer(current)
    current.controller.abort()
  }, [])

  const execute = useCallback(async function execute(decisions?: Decisions) {
    const current = connection.current
    if (!current) return
    if (decisions) current.decisions = decisions
    if (running.current) return
    cancelTimer(current)
    if (!navigator.onLine) {
      setView((view) => ({ ...view, state: 'pending', message: '오프라인이에요. 기록은 기기에 저장돼요.' }))
      return
    }
    const wait = current.retryAt - Date.now()
    if (wait > 0) {
      schedule(current, wait, () => void execute())
      return
    }
    running.current = current
    current.queued = false
    const choices = current.decisions
    setView((view) => ({ ...view, message: '', state: current.verified ? 'syncing' : 'connecting' }))
    try {
      if (!navigator.locks) throw new GitHubError('동기화하려면 최신 Chrome 또는 Edge의 HTTPS 페이지에서 열어 주세요.', 'format')
      await navigator.locks.request('workout-tracker-github-sync', { signal: current.controller.signal }, async () => {
        if (!current.verified) {
          await current.api.connect()
          current.verified = true
        }
        current.controller.signal.throwIfAborted()
        setView((view) => ({ ...view, state: 'syncing' }))
        await synchronize(repo, current.api, choices, current.controller.signal)
      })
      if (connection.current !== current) return
      current.failures = 0
      current.credentialsBlocked = false
      if (current.decisions === choices) current.decisions = undefined
      setView({ ...idle, lastSync: Date.now(), state: current.queued ? 'pending' : 'synced' })
    } catch (error) {
      if (connection.current !== current) return
      if (error instanceof SyncConflict) {
        if (current.decisions === choices) current.decisions = undefined
        setView((view) => ({ ...view, state: 'conflict', conflicts: error.conflicts, message: error.message }))
      } else if (error instanceof GitHubError) {
        setView((view) => ({ ...view, message: error.message, state: error.kind === 'network' || error.kind === 'rate' ? 'pending' : 'error' }))
        if (error.kind === 'auth') saveToken(null)
        current.credentialsBlocked = error.kind === 'auth' || error.kind === 'permission'
        if (error.kind === 'network' || error.kind === 'rate' || error.kind === 'sha') {
          const now = Date.now()
          const delay = Math.min(120000, 2000 * 2 ** Math.min(++current.failures, 6))
          current.retryAt = Math.max(now + delay, error.retryAt ?? 0)
          schedule(current, current.retryAt - now, () => void execute())
        }
      } else {
        setView((view) => ({ ...view, state: 'error', message: '원격 JSON이나 기기 저장소를 검증하지 못했어요. 해당 파일의 동기화를 중단했어요.' }))
      }
    } finally {
      running.current = null
      const next = connection.current
      if (next && next !== current) void execute()
      else if (next?.queued && next.timer === undefined && !next.credentialsBlocked) {
        schedule(next, saveDelay, () => void execute())
      }
    }
  }, [repo])

  const connect = useCallback((token: string, remember: boolean) => {
    const value = token.trim()
    if (!value) return
    if (!value.startsWith('github_pat_')) {
      setView((view) => ({ ...view, state: 'error', message: 'GitHub에서 발급한 fine-grained PAT를 입력해 주세요.' }))
      return
    }
    stop()
    const controller = new AbortController()
    connection.current = {
      api: new GitHubStorage(value, fetch, controller.signal), controller, verified: false,
      credentialsBlocked: false, retryAt: 0, failures: 0, queued: false,
    }
    setView(idle)
    setConnected(true)
    saveToken(remember ? value : null)
    void execute()
  }, [execute, stop])

  const disconnect = useCallback(() => {
    stop()
    saveToken(null)
    setView(idle)
    setConnected(false)
  }, [stop])

  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(tokenStorageKey) } catch { /* Browser storage is unavailable. */ }
    if (saved) connect(saved, true)
    const online = () => { if (!connection.current?.credentialsBlocked) void execute() }
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('online', online)
      stop()
    }
  }, [connect, execute, stop])

  const queue = useCallback(() => {
    const current = connection.current
    if (!current || current.credentialsBlocked) return
    if (running.current) {
      current.queued = true
      return
    }
    setView((view) => view.state === 'conflict' || view.state === 'error' ? view : { ...view, state: 'pending' })
    schedule(current, Math.max(saveDelay, current.retryAt - Date.now()), () => void execute())
  }, [execute])

  return { ...view, status: statuses[view.state], connected, connect, disconnect, queue, execute }
}
