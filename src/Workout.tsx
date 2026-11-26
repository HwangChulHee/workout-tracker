import { useState, type ReactNode } from 'react'
import { Check, Copy, Dumbbell, Plus, Trash2 } from 'lucide-react'
import { isDate, sessionVolumeSummary, sideWeight, type CatalogEntry, type Exercise, type MeasurementType, type Session, type SetEntry } from './model'
import { exerciseMeasurementType, isLegacyExercise, officialCatalog, officialExercise, searchExercises } from './catalog'
import type { WorkoutRepository } from './repository'

export type Run = (action: () => Promise<unknown>, success?: string) => Promise<boolean>

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

function NumberInput({ label, value, max, step = 1, onSave }: {
  label: string; value: number | null | undefined; max: number; step?: number
  onSave: (value: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <input type="number" aria-label={label} min={0} max={max} step={step} value={draft ?? value ?? ''}
    onChange={(event) => {
      const field = event.currentTarget
      setDraft(field.value)
      if (field.value !== '' && field.validity.valid) onSave(field.valueAsNumber)
    }}
    onBlur={() => {
      if (draft === '') onSave(null)
      setDraft(null)
    }} />
}

type NumericSetField = 'weightKg' | 'reps' | 'durationSeconds' | 'restSeconds' | 'failedAttemptRep'
  | 'leftWeightKg' | 'rightWeightKg' | 'leftReps' | 'rightReps' | 'leftFailedAttemptRep' | 'rightFailedAttemptRep'
type FlagSetField = 'repsEstimated' | 'durationEstimated' | 'restSecondsEstimated' | 'formUnstable'
  | 'leftRepsEstimated' | 'rightRepsEstimated'

function SetFlag({ label, checked, onSave }: {
  label: string; checked: boolean; onSave: (value: boolean) => Promise<boolean>
}) {
  const [pending, setPending] = useState<boolean | null>(null)
  return <label className="toggle justify-start">
    <input type="checkbox" checked={pending ?? checked} disabled={pending !== null}
      onChange={async (event) => {
        const next = event.target.checked
        setPending(next)
        await onSave(next)
        setPending(null)
      }} />{label}
  </label>
}

function SetEditor({ set, index, type, save, toggle, remove }: {
  set: SetEntry; index: number; type: MeasurementType
  save: <K extends Exclude<keyof SetEntry, 'id' | 'completed'>>(key: K, value: SetEntry[K]) => Promise<boolean>
  toggle: () => void; remove: () => void
}) {
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [resultDraft, setResultDraft] = useState<string | null>(null)
  const number = (key: NumericSetField, label: string, max: number, step = 1) =>
    <label>{label}<NumberInput label={`세트 ${index} ${label}`} value={set[key]} max={max}
      step={step} onSave={(value) => save(key, key.includes('Attempt') && value === 0 ? null : value)} /></label>
  const flag = (key: FlagSetField, label: string) =>
    <SetFlag label={label} checked={Boolean(set[key])} onSave={(value) => save(key, value)} />
  const unilateral = type === 'unilateral-weight-reps'

  return <div className="set-editor">
    <div className="set-toolbar">
      <strong>세트 {index}</strong>
      <div className="actions">
        <button className="icon check" aria-label={`세트 ${index} 완료`} aria-pressed={set.completed}
          onClick={toggle}><Check size={20} /></button>
        <button className="icon danger" aria-label={`세트 ${index} 삭제`} onClick={remove}><Trash2 size={16} /></button>
      </div>
    </div>
    <div className="form-grid">
      {type === 'duration' ? number('durationSeconds', '유지 시간(초)', 86400, 0.01)
        : unilateral ? <>
          {number('leftWeightKg', '왼쪽 중량(kg)', 2000, 0.01)}
          {number('rightWeightKg', '오른쪽 중량(kg)', 2000, 0.01)}
          {number('leftReps', '왼쪽 횟수', 1000)}
          {number('rightReps', '오른쪽 횟수', 1000)}
          {set.weightKg != null && <p className="muted">공통 중량 {set.weightKg} kg</p>}
        </> : <>
          {type === 'weight-reps' && number('weightKg', '중량', 2000, 0.01)}
          {number('reps', '횟수', 1000)}
        </>}
    </div>
    <details>
      <summary>세트 상세</summary>
      <div className="form-grid mt-2">
        {number('restSeconds', '실제 휴식(초)', 86400, 0.01)}
        <label>수행 결과<select value={resultDraft ?? (set.successful == null ? '' : String(set.successful))}
          disabled={resultDraft !== null} onChange={async (event) => {
            const result = event.target.value
            setResultDraft(result)
            await save('successful', result === '' ? null : result === 'true')
            setResultDraft(null)
          }}>
          <option value="">미기록</option><option value="true">성공</option><option value="false">실패</option>
        </select></label>
        {type !== 'duration' && (unilateral ? <>
          {number('leftFailedAttemptRep', '왼쪽 실패 반복 위치', 1000)}
          {number('rightFailedAttemptRep', '오른쪽 실패 반복 위치', 1000)}
        </> : number('failedAttemptRep', '실패 반복 위치', 1000))}
        {type === 'duration' ? flag('durationEstimated', '유지 시간 추정') : unilateral ? <>
          {flag('leftRepsEstimated', '왼쪽 횟수 추정')}
          {flag('rightRepsEstimated', '오른쪽 횟수 추정')}
        </> : flag('repsEstimated', '횟수 추정')}
        {flag('restSecondsEstimated', '휴식 시간 추정')}
        {flag('formUnstable', '자세 불안정')}
      </div>
      <label className="mt-2">자세 및 수행 메모<textarea maxLength={10000} rows={2} value={notesDraft ?? set.notes ?? ''}
        onChange={(event) => {
          const value = event.target.value
          setNotesDraft(value)
          void save('notes', value || null)
        }} onBlur={() => setNotesDraft(null)} /></label>
    </details>
  </div>
}

function ExerciseCard({ date, exercise, previous, repo, run, complete }: {
  date: string
  exercise: Exercise
  previous?: { date: string; exercise: Exercise }
  repo: WorkoutRepository
  run: Run
  complete: (seconds: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [rest, setRest] = useState<string | null>(null)
  const [confirmedKey, setConfirmedKey] = useState('')
  const { id } = exercise
  const official = officialExercise(exercise.exerciseKey)
  const type = exerciseMeasurementType(exercise)

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
    {official && <p className="muted mt-2">{official.nameEn} · {[official.equipment, ...(official.modifiers ?? [])].join(' · ')}</p>}
    {previous && <details className="mt-2">
      <summary>이전 수행 · {previous.date}</summary>
      <ul className="space-y-1">
        {previous.exercise.sets.map((set, index) => <li key={set.id} className="muted">
          {index + 1}세트 · {previousSetText(set, exerciseMeasurementType(previous.exercise))}
        </li>)}
      </ul>
    </details>}
    {isLegacyExercise(exercise.exerciseKey) && <details className="mt-2">
      <summary>이전 종목 코드 확인</summary>
      <label className="mt-2">공식 종목 선택<select aria-label="공식 종목 선택" value={confirmedKey} onChange={(event) => setConfirmedKey(event.target.value)}>
        <option value="">장비와 수행 방식을 확인해 선택</option>
        {officialCatalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <button className="secondary mt-2" disabled={!confirmedKey} onClick={() => {
        if (window.confirm('이 운동 기록에 선택한 공식 종목을 적용할까요?')) {
          void run(() => repo.assignExerciseKey(date, id, confirmedKey))
        }
      }}>공식 종목 적용</button>
    </details>}
    <label className="rest-setting">기본 휴식
      <input type="number" min={1} max={3600} aria-label="기본 휴식(초)"
        value={rest ?? exercise.restSeconds ?? ''}
        onChange={(e) => {
          setRest(e.target.value)
          if (e.target.value && e.target.validity.valid) {
            const seconds = e.target.valueAsNumber
            void run(() => repo.updateRestDefault(date, id, seconds))
          }
        }} onBlur={() => setRest(null)} /> 초
    </label>
    {exercise.sets.map((set, index) => <SetEditor key={set.id} set={set} index={index + 1} type={type}
        save={(field, value) => run(() => repo.updateSetValue(date, id, set.id, field, value))}
        toggle={() => void run(async () => {
          const seconds = await repo.toggleSetCompletion(date, id, set.id)
          if (seconds !== undefined) complete(seconds)
        })}
        remove={() => void run(() => repo.removeSet(date, id, set.id))} />)}
    <button className="secondary w-full mt-3" onClick={() => void run(() => repo.addSet(date, id))}>
      <Plus size={18} /> 세트 추가
    </button>
  </article>
}

function previousSetText(set: SetEntry, type: MeasurementType) {
  const value = (number: number | null | undefined, unit: string, estimated = false) =>
    number == null ? '미기록' : (estimated ? '약 ' : '') + number + unit
  if (type === 'duration') return value(set.durationSeconds, '초', set.durationEstimated)
  if (type === 'unilateral-weight-reps') {
    return '왼쪽 ' + value(sideWeight(set, 'left'), 'kg')
      + ' × ' + value(set.leftReps, '회', set.leftRepsEstimated)
      + ' · 오른쪽 ' + value(sideWeight(set, 'right'), 'kg')
      + ' × ' + value(set.rightReps, '회', set.rightRepsEstimated)
  }
  return (type === 'weight-reps' ? value(set.weightKg, 'kg') + ' × ' : '') + value(set.reps, '회', set.repsEstimated)
}

function volumeText(session: Session | undefined) {
  if (!session) return '미기록'
  const { known, total, partial, estimated } = sessionVolumeSummary(session)
  if (!known) return '미기록'
  return (estimated ? '약 ' : '') + total.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' kg' + (partial ? ' (일부)' : '')
}

export function Workout({ date, setDate, sessions, catalog, repo, run, onComplete }: {
  date: string; setDate: (date: string) => void; sessions: Session[]; catalog: CatalogEntry[]
  repo: WorkoutRepository; run: Run; onComplete: (seconds: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [equipment, setEquipment] = useState('')
  const [measurementType, setMeasurementType] = useState<MeasurementType>('weight-reps')
  const [seconds, setSeconds] = useState('90')
  const session = sessions.find((entry) => entry.date === date)
  const previous = sessions.find((entry) => entry.date < date && entry.exercises.length > 0)
  const sets = session?.exercises.flatMap((exercise) => exercise.sets) ?? []
  const matching = catalog.find((entry) => entry.id === choice)
  const latest = new Map<string, { date: string; exercise: Exercise }>()
  for (const prior of sessions) {
    if (prior.date >= date) continue
    for (const exercise of prior.exercises) {
      if (!latest.has(exercise.exerciseKey)) latest.set(exercise.exerciseKey, { date: prior.date, exercise })
    }
  }
  const options = searchExercises(catalog, query).sort((left, right) =>
    (latest.get(right.id)?.date ?? '').localeCompare(latest.get(left.id)?.date ?? ''))

  return <>
    <section className="panel date-panel">
      <label>운동 날짜<input type="date" value={date} onChange={(e) => { if (isDate(e.target.value)) setDate(e.target.value) }} /></label>
      <div><span className="muted">완료 세트</span><strong>{sets.filter((set) => set.completed).length}<small> / {sets.length}</small></strong></div>
      <div><span className="muted">운동 볼륨</span><strong>{volumeText(session)}</strong></div>
    </section>
    {sets.some((set) => set.completed && set.durationSeconds != null) && <p className="muted">
      기록된 유지 시간 합계 {sets.reduce((seconds, set) => seconds + (set.completed ? set.durationSeconds ?? 0 : 0), 0).toLocaleString('ko-KR')}초
    </p>}
    <div className="section-heading">
      <h2>운동 종목</h2>
      {previous && <button className="secondary" onClick={() => {
        if (!session?.exercises.length || window.confirm('이전 운동을 현재 기록에 추가할까요?')) {
          void run(() => repo.copySession(previous, date), '이전 운동을 불러왔어요.')
        }
      }}><Copy size={16} /> 이전 운동 불러오기</button>}
    </div>
    {session?.exercises.map((exercise) => <ExerciseCard key={exercise.id} date={date}
      exercise={exercise} previous={latest.get(exercise.exerciseKey)} repo={repo} run={run} complete={onComplete} />)}
    {!session?.exercises.length && <Empty><Dumbbell size={26} /><p>이 날짜에 기록한 운동이 없어요.</p></Empty>}
    {adding ? <form className="panel stack" onSubmit={async (event) => {
      event.preventDefault()
      if (!matching && !name.trim()) return
      if (await run(() => repo.addExercise(date, matching?.id ?? {
        name: name.trim(), nameEn: nameEn.trim() || undefined, equipment: equipment.trim() || undefined,
        measurementType, restSeconds: Number(seconds),
      }))) {
        setAdding(false)
        setChoice('')
        setName('')
        setQuery('')
        setNameEn('')
        setEquipment('')
        setMeasurementType('weight-reps')
        setSeconds('90')
      }
    }}>
      <label>종목 검색<input type="search" placeholder="한국어, 영어, 별칭 또는 장비" value={query}
        onChange={(event) => { setQuery(event.target.value); setChoice('') }} /></label>
      <label>종목 선택<select aria-label="종목 선택" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">직접 입력</option>
        {options.map((entry) => <option key={entry.id} value={entry.id}>
          {[entry.name, entry.nameEn, entry.equipment, ...(entry.modifiers ?? [])].filter(Boolean).join(' · ')} ({entry.restSeconds}초)
        </option>)}
      </select></label>
      {!matching && <div className="form-grid">
        <label>종목 이름<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 레그프레스" /></label>
        <label>영어 이름<input maxLength={120} value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label>
        <label>장비<input maxLength={120} value={equipment} onChange={(e) => setEquipment(e.target.value)} /></label>
        <label>기록 방식<select value={measurementType} onChange={(e) => setMeasurementType(e.target.value as MeasurementType)}>
          <option value="weight-reps">중량·횟수</option><option value="reps">횟수</option>
          <option value="duration">시간</option><option value="unilateral-weight-reps">좌우 중량·횟수</option>
        </select></label>
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
      <p>{volumeText(session)}</p>
      <div className="actions">
        <button className="secondary" onClick={() => open(session.date)}>수정</button>
        <button className="secondary" onClick={() => copy(session, target)} disabled={session.date === target}>복사</button>
        <button className="secondary danger" onClick={() => remove(session.date)}>삭제</button>
      </div>
    </article>)}
  </>
}
