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

export function useGitHubSync(repo: WorkoutRepository) {
  const connection = useRef<{ api: GitHubStorage; controller: AbortController; verified: boolean }>(null)
  const busy = useRef(false)
  const queued = useRef(false)
  const credentialsBlocked = useRef(false)
  const retryAt = useRef(0)
  const failures = useRef(0)
  const timeout = useRef<number | undefined>(undefined)
  const [state, setState] = useState<Status>('local')
  const [connected, setConnected] = useState(false)
  const [message, setMessage] = useState('')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [lastSync, setLastSync] = useState<number>()

  const execute = useCallback(async function execute(decisions: Decisions = {}) {
    const current = connection.current
    if (!current || busy.current) return
    clearTimeout(timeout.current)
    timeout.current = undefined
    if (!navigator.onLine) {
      setState('pending')
      setMessage('오프라인이에요. 기록은 기기에 저장돼요.')
      return
    }
    if (Date.now() < retryAt.current) {
      timeout.current = window.setTimeout(() => void execute(decisions), retryAt.current - Date.now())
      return
    }
    busy.current = true
    queued.current = false
    setMessage('')
    setState(current.verified ? 'syncing' : 'connecting')
    try {
      if (!navigator.locks) throw new GitHubError('동기화하려면 최신 Chrome 또는 Edge의 HTTPS 페이지에서 열어 주세요.', 'format')
      await navigator.locks.request('workout-tracker-github-sync', { signal: current.controller.signal }, async () => {
        if (!current.verified) {
          await current.api.connect()
          current.verified = true
        }
        if (connection.current !== current) return
        setState('syncing')
        await synchronize(repo, current.api, decisions, current.controller.signal)
      })
      if (connection.current !== current) return
      failures.current = 0
      credentialsBlocked.current = false
      setConflicts([])
      setLastSync(Date.now())
      setState('synced')
    } catch (error) {
      if (connection.current !== current) return
      if (error instanceof SyncConflict) {
        setConflicts(error.conflicts)
        setMessage(error.message)
        setState('conflict')
      } else if (error instanceof GitHubError) {
        setMessage(error.message)
        setState(error.kind === 'network' || error.kind === 'rate' ? 'pending' : 'error')
        if (error.kind === 'auth') {
          try { localStorage.removeItem(tokenStorageKey) } catch { /* Browser storage is unavailable. */ }
        }
        credentialsBlocked.current = error.kind === 'auth' || error.kind === 'permission'
        if (['network', 'rate', 'sha'].includes(error.kind)) {
          const delay = Math.min(120000, 2000 * 2 ** Math.min(++failures.current, 6))
          retryAt.current = Math.max(Date.now() + delay, error.retryAt ?? 0)
          timeout.current = window.setTimeout(() => void execute(decisions), retryAt.current - Date.now())
        }
      } else {
        setMessage('원격 JSON이나 기기 저장소를 검증하지 못했어요. 해당 파일의 동기화를 중단했어요.')
        setState('error')
      }
    } finally {
      busy.current = false
      if (connection.current !== current && connection.current) void execute()
      else if (queued.current && connection.current === current && !timeout.current && !credentialsBlocked.current) {
        timeout.current = window.setTimeout(() => void execute(), 3000)
      }
    }
  }, [repo])

  const connect = useCallback((token: string, remember: boolean) => {
    const value = token.trim()
    if (!value) return
    if (!value.startsWith('github_pat_')) {
      setState('error')
      setMessage('GitHub에서 발급한 fine-grained PAT를 입력해 주세요.')
      return
    }
    connection.current?.controller.abort()
    clearTimeout(timeout.current)
    timeout.current = undefined
    retryAt.current = 0
    failures.current = 0
    credentialsBlocked.current = false
    setConflicts([])
    const controller = new AbortController()
    connection.current = { api: new GitHubStorage(value, fetch, controller.signal), controller, verified: false }
    setConnected(true)
    try {
      if (remember) localStorage.setItem(tokenStorageKey, value)
      else localStorage.removeItem(tokenStorageKey)
    } catch { /* This session can still use the token in memory. */ }
    void execute()
  }, [execute])

  const disconnect = useCallback(() => {
    connection.current?.controller.abort()
    connection.current = null
    clearTimeout(timeout.current)
    timeout.current = undefined
    queued.current = false
    try { localStorage.removeItem(tokenStorageKey) } catch { /* Browser storage is unavailable. */ }
    setState('local')
    setMessage('')
    setConflicts([])
    setConnected(false)
    setLastSync(undefined)
  }, [])

  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(tokenStorageKey) } catch { /* Browser storage is unavailable. */ }
    if (saved) connect(saved, true)
    const online = () => { if (!credentialsBlocked.current) void execute() }
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('online', online)
      connection.current?.controller.abort()
      connection.current = null
      clearTimeout(timeout.current)
    }
  }, [connect, execute])

  const queue = useCallback(() => {
    if (!connection.current || credentialsBlocked.current) return
    if (busy.current) {
      queued.current = true
      return
    }
    clearTimeout(timeout.current)
    setState((previous) => previous === 'conflict' || previous === 'error' ? previous : 'pending')
    timeout.current = window.setTimeout(() => void execute(), Math.max(3000, retryAt.current - Date.now()))
  }, [execute])

  return { state, status: statuses[state], connected, message, conflicts, lastSync, connect, disconnect, queue, execute }
}

function formatValue(value: unknown) {
  return value === undefined ? '기록 없음 또는 삭제' : JSON.stringify(value, null, 2)
}

export function SyncSettings({ sync }: { sync: ReturnType<typeof useGitHubSync> }) {
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(false)
  const [decisions, setDecisions] = useState<Decisions>({})
  const running = sync.state === 'syncing' || sync.state === 'connecting'
  const resolvable = sync.conflicts.filter((conflict) => conflict.resolvable)
  const ready = resolvable.length > 0 && resolvable.every((conflict) => decisions[conflict.path]?.signature === conflict.signature)

  return <section className="panel stack">
    <h2>GitHub 동기화</h2>
    <p className="muted">비공개 HwangChulHee/workout-data와 이 기기의 기록을 양방향으로 동기화해요.</p>
    <p role="status">{sync.status}{sync.lastSync ? ' · ' + new Date(sync.lastSync).toLocaleString('ko-KR') : ''}</p>
    {sync.message && <p className="muted">{sync.message}</p>}
    <form className="stack" onSubmit={(event) => {
      event.preventDefault()
      sync.connect(token, remember)
      setToken('')
      setDecisions({})
    }}>
      <label>GitHub fine-grained PAT<input type="password" autoComplete="off" spellCheck={false}
        value={token} onChange={(event) => setToken(event.target.value)} required /></label>
      <label className="toggle justify-start"><input type="checkbox" checked={remember}
        onChange={(event) => setRemember(event.target.checked)} /> 이 브라우저에 토큰 기억하기</label>
      <p className="muted">기본값은 이번 실행 동안만 기억해요. 브라우저에 기억한 토큰은 사이트 스크립트나 기기가 침해되면 노출될 수 있어요.</p>
      <button className="primary self-start" disabled={!token.trim() || running}>{sync.connected ? '토큰 교체 및 동기화' : '연결 및 동기화'}</button>
    </form>
    {sync.connected && <div className="actions">
      <button className="secondary" onClick={() => void sync.execute()} disabled={running}>지금 동기화</button>
      <button className="secondary" onClick={sync.disconnect}>연결 해제</button>
    </div>}
    {sync.conflicts.length > 0 && <div className="stack">
      <h3>충돌 해결</h3>
      {sync.conflicts.map((conflict) => <details key={conflict.path}>
        <summary className="break-words">{conflict.path}</summary>
        {!conflict.resolvable ? <p>{conflict.reason}</p>
          : <div className="stack">
            <div className="form-grid sync-diff">
              <div><strong>기기</strong><pre>{formatValue(conflict.local)}</pre></div>
              <div><strong>GitHub</strong><pre>{formatValue(conflict.remote)}</pre></div>
            </div>
            <label>적용할 변경<select value={decisions[conflict.path]?.signature === conflict.signature ? decisions[conflict.path].choice : ''}
              onChange={(event) => {
                const choice = event.target.value
                setDecisions((current) => {
                  const next = { ...current }
                  if (choice === 'local' || choice === 'remote') next[conflict.path] = { signature: conflict.signature, choice }
                  else delete next[conflict.path]
                  return next
                })
              }}><option value="">선택</option><option value="local">기기 기록</option><option value="remote">GitHub 기록</option></select></label>
          </div>}
      </details>)}
      <button className="primary" disabled={!ready || running} onClick={() => void sync.execute(decisions)}>선택 적용 후 동기화</button>
    </div>}
  </section>
}
