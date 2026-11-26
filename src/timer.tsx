import { useCallback, useEffect, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { remainingSeconds } from './model'

type Clock = { endAt: number; pausedMs: number; duration: number }
const initial: Clock = { endAt: 0, pausedMs: 90000, duration: 90 }

export function useTimer() {
  const [clock, setClock] = useState<Clock>(initial)
  const [now, setNow] = useState(Date.now)
  const [auto, setAuto] = useState(() => localStorage.getItem('rest-auto') === 'true')
  const start = useCallback((seconds: number) => {
    const time = Date.now()
    setNow(time)
    setClock({ endAt: time + seconds * 1000, pausedMs: 0, duration: seconds })
  }, [])

  useEffect(() => {
    if (!clock.endAt) return
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (time >= clock.endAt) {
        setClock({ endAt: 0, pausedMs: 0, duration: clock.duration })
        navigator.vibrate?.(300)
      }
    }
    const interval = window.setInterval(tick, 150)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [clock])

  return {
    auto,
    setAuto: (value: boolean) => {
      setAuto(value)
      localStorage.setItem('rest-auto', String(value))
    },
    start,
    duration: clock.duration,
    running: clock.endAt > 0,
    finished: clock.endAt === 0 && clock.pausedMs === 0,
    seconds: clock.endAt ? remainingSeconds(clock.endAt, now) : Math.ceil(clock.pausedMs / 1000),
    pause: () => setClock({ ...clock, endAt: 0, pausedMs: Math.max(0, clock.endAt - Date.now()) }),
    resume: () => {
      if (!clock.pausedMs) return start(clock.duration)
      const time = Date.now()
      setNow(time)
      setClock({ ...clock, endAt: time + clock.pausedMs, pausedMs: 0 })
    },
    reset: (duration = clock.duration) => setClock({ endAt: 0, pausedMs: duration * 1000, duration }),
  }
}

export function TimerScreen({ timer }: { timer: ReturnType<typeof useTimer> }) {
  const [custom, setCustom] = useState('')
  return <section className="panel timer-panel">
    <p className="muted">세트 사이 휴식</p>
    <div className="clock" role="timer" aria-label="남은 시간">
      {Math.floor(timer.seconds / 60)}:{String(timer.seconds % 60).padStart(2, '0')}
    </div>
    {timer.seconds === 0 && <p role="status">휴식 완료</p>}
    <div className="actions justify-center">
      {timer.running
        ? <button className="primary" onClick={timer.pause}><Pause size={18} /> 일시정지</button>
        : <button className="primary" onClick={timer.resume}><Play size={18} /> 시작</button>}
      <button className="secondary" onClick={() => timer.reset()}><RotateCcw size={18} /> 초기화</button>
    </div>
    <div className="actions justify-center">
      {[60, 90, 120, 180].map((seconds) => <button key={seconds} className="secondary"
        aria-pressed={timer.duration === seconds} onClick={() => timer.reset(seconds)}>{seconds}초</button>)}
    </div>
    <form className="actions justify-center" onSubmit={(e) => { e.preventDefault(); timer.reset(Number(custom)); setCustom('') }}>
      <label>사용자 지정(초)<input type="number" required min={1} max={3600} value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
      <button className="secondary self-end">적용</button>
    </form>
    <label className="toggle"><input type="checkbox" checked={timer.auto} onChange={(e) => timer.setAuto(e.target.checked)} /> 세트 완료 시 자동 시작</label>
    <p className="muted">화면 잠금 중에는 진동이 울리지 않을 수 있어요.</p>
  </section>
}
