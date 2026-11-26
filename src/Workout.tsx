import { useState, type ReactNode } from 'react'
import { Check, Copy, Dumbbell, Plus, Trash2 } from 'lucide-react'
import { isDate, sessionVolume, type CatalogEntry, type Exercise, type Session } from './model'
import type { WorkoutRepository } from './repository'

export type Run = (action: () => Promise<unknown>, success?: string) => Promise<boolean>

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

function NumberInput({ label, value, max, step = 1, onSave }: {
  label: string; value: number; max: number; step?: number; onSave: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <input type="number" aria-label={label} min={0} max={max} step={step} value={draft ?? value}
    onChange={(event) => {
      const field = event.currentTarget
      setDraft(field.value)
      if (field.value !== '' && field.validity.valid) onSave(field.valueAsNumber)
    }}
    onBlur={() => setDraft(null)} />
}

function ExerciseCard({ date, exercise, repo, run, complete }: {
  date: string
  exercise: Exercise
  repo: WorkoutRepository
  run: Run
  complete: (seconds: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [rest, setRest] = useState<string | null>(null)
  const { id } = exercise

  return <article className="panel exercise">
    <div className="exercise-heading">
      <input className="exercise-name" aria-label="종목 이름" maxLength={80} value={draft ?? exercise.name}
        onChange={(e) => {
          setDraft(e.target.value)
          const name = e.target.value.trim()
          if (name) void run(() => repo.renameExercise(date, id, name))
        }} onBlur={() => setDraft(null)} />
      <button className="icon danger" aria-label={exercise.name + ' 삭제'} onClick={() => {
        if (window.confirm(exercise.name + ' 기록을 삭제할까요?')) void run(() => repo.removeExercise(date, id))
      }}><Trash2 size={18} /></button>
    </div>
    <label className="rest-setting">기본 휴식
      <input type="number" min={1} max={3600} aria-label="기본 휴식(초)"
        value={rest ?? exercise.restSeconds}
        onChange={(e) => {
          setRest(e.target.value)
          if (e.target.value && e.target.validity.valid) {
            const seconds = e.target.valueAsNumber
            void run(() => repo.updateRestDefault(date, id, seconds))
          }
        }} onBlur={() => setRest(null)} /> 초
    </label>
    {exercise.sets.length > 0 && <div className="set-row set-labels"><span>세트</span><span>중량 kg</span><span>횟수</span><span>완료</span><span /></div>}
    {exercise.sets.map((set, index) => <div className="set-row" key={set.id}>
      <span className="set-index">{index + 1}</span>
      <NumberInput label={`세트 ${index + 1} 중량`} value={set.weightKg} max={2000} step={0.01}
        onSave={(weightKg) => void run(() => repo.updateSetValue(date, id, set.id, 'weightKg', weightKg))} />
      <NumberInput label={`세트 ${index + 1} 횟수`} value={set.reps} max={1000}
        onSave={(reps) => void run(() => repo.updateSetValue(date, id, set.id, 'reps', reps))} />
      <button className="icon check" aria-label={`세트 ${index + 1} 완료`} aria-pressed={set.completed}
        onClick={() => void run(async () => {
          const seconds = await repo.toggleSetCompletion(date, id, set.id)
          if (seconds !== undefined) complete(seconds)
        })}><Check size={20} /></button>
      <button className="icon danger" aria-label={`세트 ${index + 1} 삭제`}
        onClick={() => void run(() => repo.removeSet(date, id, set.id))}><Trash2 size={16} /></button>
    </div>)}
    <button className="secondary w-full mt-3" onClick={() => void run(() => repo.addSet(date, id))}>
      <Plus size={18} /> 세트 추가
    </button>
  </article>
}

export function Workout({ date, setDate, sessions, catalog, repo, run, onComplete }: {
  date: string; setDate: (date: string) => void; sessions: Session[]; catalog: CatalogEntry[]
  repo: WorkoutRepository; run: Run; onComplete: (seconds: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [seconds, setSeconds] = useState('90')
  const session = sessions.find((entry) => entry.date === date)
  const previous = sessions.find((entry) => entry.date < date && entry.exercises.length > 0)
  const sets = session?.exercises.flatMap((exercise) => exercise.sets) ?? []
  const matching = catalog.find((entry) => entry.id === choice)

  return <>
    <section className="panel date-panel">
      <label>운동 날짜<input type="date" value={date} onChange={(e) => { if (isDate(e.target.value)) setDate(e.target.value) }} /></label>
      <div><span className="muted">완료 세트</span><strong>{sets.filter((set) => set.completed).length}<small> / {sets.length}</small></strong></div>
      <div><span className="muted">운동 볼륨</span><strong>{(session ? sessionVolume(session) : 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<small> kg</small></strong></div>
    </section>
    <div className="section-heading">
      <h2>운동 종목</h2>
      {previous && <button className="secondary" onClick={() => {
        if (!session?.exercises.length || window.confirm('이전 운동을 현재 기록에 추가할까요?')) {
          void run(() => repo.copySession(previous, date), '이전 운동을 불러왔어요.')
        }
      }}><Copy size={16} /> 이전 운동 불러오기</button>}
    </div>
    {session?.exercises.map((exercise) => <ExerciseCard key={exercise.id} date={date}
      exercise={exercise} repo={repo} run={run} complete={onComplete} />)}
    {!session?.exercises.length && <Empty><Dumbbell size={26} /><p>이 날짜에 기록한 운동이 없어요.</p></Empty>}
    {adding ? <form className="panel stack" onSubmit={async (event) => {
      event.preventDefault()
      if (!matching && !name.trim()) return
      if (await run(() => repo.addExercise(date, matching?.id ?? { name: name.trim(), restSeconds: Number(seconds) }))) {
        setAdding(false)
        setChoice('')
        setName('')
        setSeconds('90')
      }
    }}>
      <label>종목 선택<select value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">직접 입력</option>
        {catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.restSeconds}초)</option>)}
      </select></label>
      {!matching && <div className="form-grid">
        <label>종목 이름<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 레그프레스" /></label>
        <label>기본 휴식(초)<input type="number" required min={1} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} /></label>
      </div>}
      <div className="actions"><button className="primary">추가</button><button type="button" className="secondary" onClick={() => setAdding(false)}>취소</button></div>
    </form> : <button className="primary w-full" onClick={() => setAdding(true)}><Plus size={20} /> 운동 추가</button>}
  </>
}

export function History({ sessions, date, open, copy, remove }: {
  sessions: Session[]; date: string; open: (date: string) => void
  copy: (source: Session, date: string) => void; remove: (date: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState(date)
  const visible = sessions.filter((session) => session.exercises.length > 0 && (!filter || session.date === filter))
  return <>
    <div className="panel form-grid">
      <label>조회 날짜<input type="date" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      <label>복사할 날짜<input type="date" value={target} onChange={(e) => { if (isDate(e.target.value)) setTarget(e.target.value) }} /></label>
      {filter && <button className="secondary" onClick={() => setFilter('')}>전체 이력</button>}
    </div>
    {!visible.length && <Empty>조회할 운동 기록이 없어요.</Empty>}
    {visible.map((session) => <article key={session.id} className="panel stack">
      <h2>{session.date}</h2>
      <p className="muted">{session.exercises.map((entry) => entry.name).join(' · ')}</p>
      <p>{sessionVolume(session).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} kg</p>
      <div className="actions">
        <button className="secondary" onClick={() => open(session.date)}>수정</button>
        <button className="secondary" onClick={() => copy(session, target)} disabled={session.date === target}>복사</button>
        <button className="secondary danger" onClick={() => remove(session.date)}>삭제</button>
      </div>
    </article>)}
  </>
}
