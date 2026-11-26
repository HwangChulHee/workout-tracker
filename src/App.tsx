import { useEffect, useState } from 'react'
import { Activity, ChartNoAxesCombined, ClipboardList, Dumbbell, History as HistoryIcon, Settings, Timer } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDate, type Session } from './model'
import { repository, type WorkoutRepository } from './repository'
import { demoRepository, prepareDemo } from './demo'
import { BodyRecords, Stats } from './Records'
import { TimerScreen, useTimer } from './timer'
import { Empty, History, Workout, type Run } from './Workout'
import { SyncSettings } from './SyncSettings'
import { useGitHubSync } from './useGitHubSync'
import { useRegisterSW } from 'virtual:pwa-register/react'

const tabs = [
  { id: 'workout', label: '운동', title: '운동 기록', icon: Dumbbell },
  { id: 'history', label: '이력', title: '운동 이력', icon: HistoryIcon },
  { id: 'stats', label: '통계', title: '통계', icon: ChartNoAxesCombined },
  { id: 'timer', label: '타이머', title: '휴식 타이머', icon: Timer },
  { id: 'body', label: '신체', title: '신체 기록', icon: Activity },
] as const
type Tab = typeof tabs[number]['id'] | 'settings'

function BackupSettings({ repo, run, demo, toggleDemo }: {
  repo: WorkoutRepository; run: Run; demo: boolean; toggleDemo: () => void
}) {
  return <>
    {!demo && <section className="panel stack">
      <h2>JSON 백업</h2>
      <p className="muted">운동 월별 JSON, 인바디 연별 JSON, 앱 백업을 가져올 수 있어요. 기존 기록은 유지돼요.</p>
      <p className="muted">가져오기 전에 내보내기로 현재 기록을 백업할 수 있어요.</p>
      <div className="actions">
        <button className="primary" onClick={() => void run(async () => {
          const data = await repo.exportBackup()
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a')
          link.href = url
          link.download = `workout-${localDate()}.json`
          link.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        })}>내보내기</button>
        <label className="secondary upload">가져오기<input type="file" accept=".json,application/json" aria-label="백업 가져오기"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            await run(async () => {
              const result = await repo.importBackup(await file.text())
              return `${result.added}개 가져옴 · ${result.skipped}개 건너뜀`
            })
          }} /></label>
      </div>
    </section>}
    <section className="panel stack">
      <h2>데모 모드</h2>
      <p className="muted">예시 기록은 데모 모드 전용 공간에 저장돼요.</p>
      <button className="secondary self-start" onClick={toggleDemo}>{demo ? '내 기록으로 돌아가기' : '데모 시작'}</button>
    </section>
  </>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('workout')
  const [date, setDate] = useState(localDate)
  const [demo, setDemo] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean }>()
  const repo = demo ? demoRepository : repository
  const data = useLiveQuery(async () => {
    try {
      return { repo, records: await repo.readRecords() }
    } catch {
      return { repo, records: null }
    }
  }, [repo])
  const records = data?.repo === repo ? data.records : undefined
  const timer = useTimer()
  const { needRefresh: [updateReady, setUpdateReady], updateServiceWorker } = useRegisterSW()
  const sync = useGitHubSync(repository)
  const queueSync = sync.queue

  useEffect(() => {
    if (!demo && records) queueSync()
  }, [demo, records, queueSync])

  useEffect(() => {
    if (!notice || notice.error) return
    const timeout = window.setTimeout(() => setNotice(undefined), 3500)
    return () => clearTimeout(timeout)
  }, [notice])

  const run: Run = async (action, success) => {
    try {
      const result = await action()
      const text = success ?? (typeof result === 'string' ? result : '기기에 저장했어요.')
      setNotice({ text, error: false })
      return true
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '저장에 실패했어요. 다시 시도해 주세요.', error: true })
      return false
    }
  }

  function openWorkout(date: string) {
    setDate(date)
    setTab('workout')
  }

  function copy(source: Session, target: string) {
    if (!window.confirm(`${source.date} 운동을 ${target} 기록에 추가할까요?`)) return
    void run(async () => {
      await repo.copySession(source, target)
      openWorkout(target)
    }, '운동을 복사했어요.')
  }

  const active = tabs.find((item) => item.id === tab)
  return <div className="app">
    <header className="topbar">
      <div className="top-inner">
        <div className="brand"><span className="brand-icon"><Dumbbell size={22} /></span> Workout Tracker</div>
        <div className="actions">
          {(timer.running || timer.finished) && tab !== 'timer' && <button className="secondary timer-chip" onClick={() => setTab('timer')} aria-label="휴식 타이머 열기">
            <Timer size={17} /> {timer.finished ? <span role="status">휴식 완료</span>
              : `${Math.floor(timer.seconds / 60)}:${String(timer.seconds % 60).padStart(2, '0')}`}
          </button>}
          <button className="icon" aria-label="설정" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}><Settings size={22} /></button>
        </div>
      </div>
    </header>
    <main className="content stack">
      <div className="page-heading">
        <h1>{active?.title ?? '설정'}</h1>
        <span className={demo ? 'status demo' : 'status'}><ClipboardList size={15} /> {demo ? '데모 모드' : sync.status}</span>
      </div>
      {updateReady && <section className="panel actions" aria-label="앱 업데이트">
        <span>새 버전을 설치할 수 있어요.</span>
        <button className="primary" onClick={() => void updateServiceWorker(true)} disabled={sync.state === 'syncing'}>업데이트</button>
        <button className="secondary" onClick={() => setUpdateReady(false)}>나중에</button>
      </section>}
      {tab === 'timer' && <TimerScreen timer={timer} />}
      {tab === 'settings' && <BackupSettings repo={repo} run={run} demo={demo} toggleDemo={() => {
        void run(async () => {
          if (!demo) await prepareDemo()
          setDemo(!demo)
        }, demo ? '내 기록으로 돌아왔어요.' : '데모 모드를 시작했어요.')
      }} />}
      {tab === 'settings' && !demo && <SyncSettings sync={sync} />}
      {tab !== 'timer' && tab !== 'settings' && (
        records === undefined ? <Empty>기록을 불러오는 중이에요.</Empty>
        : records === null ? <Empty>기기 저장소를 열 수 없어요. 브라우저 저장소 설정을 확인해 주세요.</Empty>
        : <>
          {tab === 'workout' && <Workout key={String(demo)} date={date} setDate={setDate} sessions={records.sessions} catalog={records.catalog}
            repo={repo} run={run} onComplete={(seconds) => { if (timer.auto) timer.start(seconds) }} />}
          {tab === 'history' && <History sessions={records.sessions} date={date} open={openWorkout} copy={copy} remove={(date) => {
            if (window.confirm(date + ' 운동 기록을 삭제할까요?')) void run(() => repo.deleteSession(date))
          }} />}
          {tab === 'stats' && <Stats sessions={records.sessions} measurements={records.measurements} />}
          {tab === 'body' && <BodyRecords entries={records.measurements} repo={repo} run={run} />}
        </>
      )}
    </main>
    {notice && <div className={notice.error ? 'toast error' : 'toast'} role={notice.error ? 'alert' : 'status'}>{notice.text}
      {notice.error && <button className="secondary" onClick={() => setNotice(undefined)}>닫기</button>}
    </div>}
    <nav className="tabbar" aria-label="주 메뉴">
      <div className="tabs">{tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined}
        onClick={() => setTab(id)}><Icon size={22} /><span>{label}</span></button>)}</div>
    </nav>
  </div>
}
