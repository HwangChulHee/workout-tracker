import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { isDate, localDate, periodCounts, sessionVolume, type Measurement, type Session } from './model'
import { Empty, type Run } from './Workout'
import type { WorkoutRepository } from './repository'

const metrics = [
  { key: 'weightKg', label: '체중', unit: 'kg', max: 500 },
  { key: 'skeletalMuscleKg', label: '골격근량', unit: 'kg', max: 250 },
  { key: 'bodyFatKg', label: '체지방량', unit: 'kg', max: 500 },
  { key: 'bodyFatPercent', label: '체지방률', unit: '%', max: 100 },
  { key: 'heightCm', label: '키', unit: 'cm', max: 300 },
] as const

const blank = (): Omit<Measurement, 'revision'> => ({
  id: crypto.randomUUID(), date: localDate(), weightKg: null, skeletalMuscleKg: null,
  bodyFatKg: null, bodyFatPercent: null, heightCm: null, notes: null,
})

export function BodyRecords({ entries, repo, run }: { entries: Measurement[]; repo: WorkoutRepository; run: Run }) {
  const [draft, setDraft] = useState(blank)
  const editing = entries.some((entry) => entry.id === draft.id)
  return <>
    <form className="panel stack" onSubmit={async (event) => {
      event.preventDefault()
      if (await run(() => {
        if (!isDate(draft.date)) throw new Error('측정 날짜를 확인해 주세요.')
        return repo.saveMeasurement(draft)
      }, '신체 기록을 저장했어요.')) setDraft(blank())
    }}>
      <h2>{editing ? '신체 기록 수정' : '새 측정'}</h2>
      <div className="form-grid">
        <label>측정 날짜<input type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
        {metrics.map(({ key, label, unit, max }) => <label key={key}>{label} ({unit})
          <input type="number" min={0} max={max} step="any" value={draft[key] ?? ''}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value === '' ? null : e.target.valueAsNumber })} />
        </label>)}
      </div>
      <label>메모<textarea maxLength={1000} rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} /></label>
      <div className="actions">
        <button className="primary" disabled={metrics.every(({ key }) => draft[key] === null)}>저장</button>
        {editing && <button type="button" className="secondary" onClick={() => setDraft(blank())}>취소</button>}
      </div>
    </form>
    {!entries.length && <Empty>저장된 신체 기록이 없어요.</Empty>}
    {entries.map((entry) => <article className="panel stack" key={entry.id}>
      <h2>{entry.date}</h2>
      <div className="form-grid">
        {metrics.map(({ key, label, unit }) => entry[key] === null ? null : <div key={key}><span className="muted">{label}</span> {entry[key]} {unit}</div>)}
      </div>
      {entry.notes && <p className="whitespace-pre-wrap break-words">{entry.notes}</p>}
      <div className="actions">
        <button className="secondary" onClick={() => setDraft(entry)}>수정</button>
        <button className="secondary danger" onClick={async () => {
          if (window.confirm('이 신체 기록을 삭제할까요?') && await run(() => repo.deleteMeasurement(entry.id)) && entry.id === draft.id) setDraft(blank())
        }}>삭제</button>
      </div>
    </article>)}
  </>
}

type Point = { date: string; value: number }

function Chart({ name, unit, points }: { name: string; unit: string; points: Point[] }) {
  return <section className="panel chart-panel">
    <h2>{name}</h2>
    {points.length ? <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 14, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="#333638" strokeDasharray="3 5" />
          <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fill: '#afb4b0', fontSize: 12 }} minTickGap={18} />
          <YAxis width={48} tick={{ fill: '#afb4b0', fontSize: 12 }} />
          <Tooltip labelStyle={{ color: '#fff' }} formatter={(value) => [`${value} ${unit}`, name]}
            contentStyle={{ background: '#242628', borderColor: '#414547', borderRadius: 10 }} itemStyle={{ color: '#c5fa65' }} />
          <Area dataKey="value" type="linear" stroke="#c5fa65" fill="#c5fa65" fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div> : <Empty>아직 그래프로 표시할 기록이 없어요.</Empty>}
  </section>
}

export function Stats({ sessions, measurements }: { sessions: Session[]; measurements: Measurement[] }) {
  const [selected, setSelected] = useState('')
  const completed = [...sessions].reverse().filter((session) => session.exercises.some((exercise) => exercise.sets.some((set) => set.completed)))
  const exercises = new Map(completed.flatMap((session) => session.exercises
    .filter((exercise) => exercise.sets.some((set) => set.completed))
    .map((exercise) => [exercise.exerciseKey, exercise.name] as const)))
  const key = exercises.has(selected) ? selected : exercises.keys().next().value
  const weights = completed.flatMap((session) => {
    const sets = session.exercises.filter((exercise) => exercise.exerciseKey === key)
      .flatMap((exercise) => exercise.sets).filter((set) => set.completed)
    return sets.length ? [{ date: session.date, value: sets.reduce((max, set) => Math.max(max, set.weightKg), 0) }] : []
  })
  const counts = periodCounts(sessions)
  return <>
    {sessions.some((session) => session.exercises.length > 0) ? <div className="form-grid">
      <div className="panel stat"><span className="muted">이번 주 운동</span><strong>{counts.week}<small> 회</small></strong></div>
      <div className="panel stat"><span className="muted">이번 달 운동</span><strong>{counts.month}<small> 회</small></strong></div>
    </div> : <Empty>아직 집계할 운동 기록이 없어요.</Empty>}
    {exercises.size > 0 && <label className="panel">운동 종목<select value={key} onChange={(event) => setSelected(event.target.value)}>
      {[...exercises].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>}
    <Chart name="종목별 최고 중량" unit="kg" points={weights} />
    <Chart name="운동 볼륨" unit="kg" points={completed.map((session) => ({ date: session.date, value: sessionVolume(session) }))} />
    {metrics.filter(({ key }) => key === 'weightKg' || key === 'skeletalMuscleKg' || key === 'bodyFatPercent')
      .map(({ key, label, unit }) => <Chart key={key} name={label} unit={unit}
        points={[...measurements].reverse().flatMap((entry) => {
          const value = entry[key]
          return value === null ? [] : [{ date: entry.date, value }]
        })} />)}
  </>
}
