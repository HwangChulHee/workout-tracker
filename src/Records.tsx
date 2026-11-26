import { memo, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { isDate, localDate, periodCounts, sessionVolumeSummary, sideWeight, type Measurement, type Session } from './model'
import { Empty, type Run } from './Workout'
import type { WorkoutRepository } from './repository'
import { bodyTrends, coreBodyMetrics, detailedBodyMetrics, segmentMetrics, segments } from './bodyMetrics'
import { exerciseMeasurementType } from './catalog'

const blank = (): Omit<Measurement, 'revision'> => ({
  id: crypto.randomUUID(), date: localDate(), weightKg: null, skeletalMuscleKg: null,
  bodyFatKg: null, bodyFatPercent: null, heightCm: null, notes: null,
})

export function BodyRecords({ entries, repo, run }: { entries: Measurement[]; repo: WorkoutRepository; run: Run }) {
  const [draft, setDraft] = useState(blank)
  const form = useRef<HTMLFormElement>(null)
  const editing = entries.some((entry) => entry.id === draft.id)
  function fields(metrics: (typeof coreBodyMetrics[number] | typeof detailedBodyMetrics[number] | typeof segmentMetrics[number])[]) {
    return metrics.map(({ key, label, unit, max }) => <label key={key}>{label}{unit && ` (${unit})`}
      <input type="number" min={0} max={max} step="any" value={draft[key] ?? ''}
        onChange={(event) => {
          const value = event.target.value === '' ? null : event.target.valueAsNumber
          setDraft((current) => ({
            ...current, [key]: value,
            ...((value !== null && current.missingFields?.includes(key))
              ? { missingFields: current.missingFields.filter((field) => field !== key) } : {}),
          }))
        }} />
    </label>)
  }

  return <>
    <form ref={form} className="panel stack" onSubmit={async (event) => {
      event.preventDefault()
      if (await run(() => {
        if (!isDate(draft.date)) throw new Error('측정 날짜를 확인해 주세요.')
        return repo.saveMeasurement(draft)
      }, '신체 기록을 저장했어요.')) setDraft(blank())
    }}>
      <h2>{editing ? '신체 기록 수정' : '새 측정'}</h2>
      <div className="form-grid">
        <label>측정 날짜<input type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
        {fields(coreBodyMetrics)}
      </div>
      <label>측정 장비<input maxLength={10000} value={draft.device ?? ''} onChange={(event) => setDraft({ ...draft, device: event.target.value || null })} /></label>
      <label>측정 조건 메모<textarea maxLength={10000} rows={2} value={draft.measurementConditions ?? ''}
        onChange={(event) => setDraft({ ...draft, measurementConditions: event.target.value || null })} /></label>
      <details>
        <summary>인바디 상세 수치</summary>
        <div className="form-grid">{fields(detailedBodyMetrics)}</div>
      </details>
      <details>
        <summary>부위별 근육량 및 체지방량</summary>
        <div className="form-grid">{fields(segmentMetrics)}</div>
      </details>
      <label>메모<textarea maxLength={10000} rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} /></label>
      <div className="actions">
        <button className="primary" disabled={!editing && [...coreBodyMetrics, ...detailedBodyMetrics, ...segmentMetrics]
          .every(({ key }) => draft[key] == null)}>저장</button>
        {editing && <button type="button" className="secondary" onClick={() => setDraft(blank())}>취소</button>}
      </div>
    </form>
    {!entries.length && <Empty>저장된 신체 기록이 없어요.</Empty>}
    {entries.map((entry, index) => <article className="panel stack" key={entry.id}>
      <h2>{entry.date}</h2>
      <div className="form-grid">
        {[...coreBodyMetrics, ...detailedBodyMetrics].map(({ key, label, unit }) => entry[key] == null ? null
          : <div key={key}><span className="muted">{label}</span> {entry[key]} {unit}</div>)}
      </div>
      {segments.some(({ muscle, fat }) => entry[muscle] != null || entry[fat] != null) && <details>
        <summary>부위별 근육량 및 체지방량</summary>
        <table className="segment-table">
          <thead><tr><th scope="col">부위</th><th scope="col">근육량(kg)</th><th scope="col">체지방량(kg)</th></tr></thead>
          <tbody>{segments.map(({ label, muscle, fat }) => <tr key={label}><th scope="row">{label}</th>
            <td>{entry[muscle] ?? '미측정'}</td><td>{entry[fat] ?? '미측정'}</td></tr>)}</tbody>
        </table>
      </details>}
      {entry.device && <p><span className="muted">측정 장비</span> {entry.device}</p>}
      {entry.measurementConditions && <p className="whitespace-pre-wrap break-words">{entry.measurementConditions}</p>}
      {entry.missingFields?.length ? <p className="muted">미측정 항목 {entry.missingFields.length}개</p> : null}
      {entries[index + 1] && <MeasurementComparison current={entry} previous={entries[index + 1]} />}
      {entry.notes && <p className="whitespace-pre-wrap break-words">{entry.notes}</p>}
      <div className="actions">
        <button className="secondary" onClick={() => {
          setDraft(entry)
          form.current?.scrollIntoView({ block: 'start' })
        }}>수정</button>
        <button className="secondary danger" onClick={async () => {
          if (window.confirm('이 신체 기록을 삭제할까요?') && await run(() => repo.deleteMeasurement(entry.id)) && entry.id === draft.id) setDraft(blank())
        }}>삭제</button>
      </div>
    </article>)}
    <BodyTrends entries={entries} />
  </>
}

function MeasurementComparison({ current, previous }: { current: Measurement; previous: Measurement }) {
  const comparisons = bodyTrends.flatMap(({ key, label, unit }) => {
    const now = current[key]
    const before = previous[key]
    if (now == null || before == null) return []
    return [{ label, value: (now - before).toLocaleString('ko-KR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
      unit: key === 'bodyFatPercent' ? '%p' : unit }]
  })
  return <details>
    <summary>이전 측정과 비교 · {previous.date}</summary>
    {comparisons.length ? <dl className="form-grid">{comparisons.map(({ label, value, unit }) => <div key={label}>
      <dt className="muted">{label}</dt><dd>{value} {unit}</dd>
    </div>)}</dl> : <p className="muted">두 기록에 공통으로 측정된 지표가 없어요.</p>}
    <p className="muted mt-2">수치는 측정 시각이나 조건에 따라 달라질 수 있어요.</p>
  </details>
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

function BodyTrends({ entries }: { entries: Measurement[] }) {
  const [days, setDays] = useState('all')
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days === 'all' ? 0 : Number(days) - 1))
  const earliest = localDate(cutoff)
  const chronological = entries.filter((entry) => days === 'all' || entry.date >= earliest)
    .sort((a, b) => a.date.localeCompare(b.date))
  return <>
    {entries.length > 0 && <label className="panel">신체 지표 추세 기간
      <select value={days} onChange={(event) => setDays(event.target.value)}>
        <option value="all">전체</option><option value="30">최근 30일</option><option value="90">최근 90일</option>
        <option value="365">최근 1년</option>
      </select>
    </label>}
    {bodyTrends.map(({ key, label, unit }) => <Chart key={key} name={label + ' 추세'} unit={unit}
    points={chronological.flatMap((entry) => {
      const value = entry[key]
      return value == null ? [] : [{ date: entry.date, value }]
    })} />)}
  </>
}

export const Stats = memo(function Stats({ sessions, measurements }: { sessions: Session[]; measurements: Measurement[] }) {
  const [selected, setSelected] = useState('')
  const completed = [...sessions].reverse().filter((session) => session.exercises.some((exercise) => exercise.sets.some((set) => set.completed)))
  const exercises = new Map(completed.flatMap((session) => session.exercises
    .filter((exercise) => exercise.sets.some((set) => set.completed))
    .map((exercise) => [exercise.exerciseKey, exercise.name] as const)))
  const key = exercises.has(selected) ? selected : exercises.keys().next().value
  const weights = completed.flatMap((session) => {
    const weights = session.exercises.filter((exercise) => exercise.exerciseKey === key)
      .flatMap((exercise) => {
        const type = exerciseMeasurementType(exercise)
        if (type === 'duration' || type === 'reps') return []
        return exercise.sets.filter((set) => set.completed).flatMap((set) => type === 'unilateral-weight-reps'
          ? [sideWeight(set, 'left'), sideWeight(set, 'right')] : [set.weightKg])
          .filter((weight): weight is number => weight != null)
      })
    return weights.length ? [{ date: session.date, value: Math.max(...weights) }] : []
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
    <Chart name="운동 볼륨" unit="kg" points={completed.flatMap((session) => {
      const volume = sessionVolumeSummary(session)
      return volume.known ? [{ date: session.date, value: volume.total }] : []
    })} />
    <BodyTrends entries={measurements} />
  </>
})
