import { useState } from 'react'
import type { useGitHubSync } from './useGitHubSync'
import type { Decisions } from './syncModel'

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
