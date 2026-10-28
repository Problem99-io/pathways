import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronUp, Flag, MapPin, CalendarClock, TrendingUp } from 'lucide-react'
import { daysBetween, pathMetrics, rankByGoal, schedule, scopeNodes, type PathMetrics } from '../../shared/metrics'
import type { Path, PathwayDoc } from '../../shared/types'
import { useStore } from '../store'
import { fmtDate, fmtDays, fmtPct } from '../lib/format'
import { softSpring } from './ui'

const STATE_TEXT: Record<PathMetrics['state'], string> = {
  not_started: 'not started',
  ahead: 'ahead',
  on_track: 'on track',
  behind: 'behind',
  complete: 'complete',
}

export function ProgressBar() {
  const doc = useStore((s) => s.doc)!
  const focus = useStore((s) => s.focusPathId ?? s.highlightPathId)
  const open = useStore((s) => s.progressOpen)
  const setOpen = useStore((s) => s.setProgressOpen)
  const select = useStore((s) => s.select)

  const path = useMemo(() => pickPath(doc, focus), [doc, focus])
  const m = useMemo(() => (path ? pathMetrics(doc, path.id) : null), [doc, path])
  // side panels end just above this bar, however tall it gets (collapsed height only)
  const ref = useRef<HTMLDivElement>(null)
  const visible = !!path && !!m && m.steps > 0
  useEffect(() => {
    const ws = document.querySelector('.workspace') as HTMLElement | null
    if (!ws) return
    if (!visible || !ref.current) {
      ws.style.setProperty('--bottom', '12px')
      return
    }
    const el = ref.current
    const ro = new ResizeObserver(() => {
      if (!useStore.getState().progressOpen) ws.style.setProperty('--bottom', `${el.offsetHeight + 22}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [visible])
  if (!path || !m || m.steps === 0) return null

  const cur = path.currentNodeId ? doc.nodes.find((n) => n.id === path.currentNodeId) : undefined
  const fronts = doc.paths.filter((p) => p.pursuing && p.status !== 'archived')
  const expected = doc.nodes.find((n) => n.id === m.expectedNodeId)
  const goal = doc.goals.find((g) => g.id === path.goalId)
  const variance = m.varianceDays
  const timePct = m.totalDays ? Math.min(1, m.elapsedDays / m.totalDays) : 0

  return (
    <motion.div ref={ref} className={`progress ${open ? 'open' : ''}`} layout transition={softSpring} style={{ '--c': path.color } as React.CSSProperties}>
      {fronts.length > 1 && (
        <div className="pg-fronts">
          {fronts.map((f) => (
            <button
              key={f.id}
              className={`pg-front ${f.id === path.id ? 'on' : ''}`}
              style={{ '--c': f.color } as React.CSSProperties}
              title={`Show progress for ${f.name}`}
              onClick={() => useStore.getState().setHighlight(f.id === path.id ? null : f.id)}
            >
              <span className="dot" style={{ background: f.color }} />
              {f.id === path.id && <span>{f.name}</span>}
            </button>
          ))}
        </div>
      )}
      <button className="pg-main" onClick={() => setOpen(!open)}>
        <div className="pg-path">
          <span className="dot" style={{ background: path.color }} />
          <b>{path.name}</b>
          <span className={`pg-state s-${m.state}`}>
            {m.state === 'ahead' || m.state === 'behind' ? `${fmtDays(Math.abs(variance))} ${STATE_TEXT[m.state]}` : STATE_TEXT[m.state]}
          </span>
        </div>
        <div className="pg-track-wrap">
          <div className="pg-track">
            <motion.div className="pg-fill" initial={false} animate={{ width: `${m.progress * 100}%` }} transition={softSpring} />
            <motion.div className="pg-plan" initial={false} animate={{ left: `${m.plannedProgress * 100}%` }} transition={softSpring} title="Where the plan says you should be" />
            <motion.div className="pg-time" initial={false} animate={{ left: `${timePct * 100}%` }} transition={softSpring} />
            {m.milestones.map((ms) => (
              <span
                key={ms.id}
                className={`pg-ms ${ms.done ? 'done' : ''} ${ms.late && !ms.done ? 'late' : ''}`}
                style={{ left: `${Math.min(ms.at, 1) * 100}%` }}
                title={`${ms.title} — ${ms.done ? `reached ${fmtDate(ms.completedAt)}` : `forecast ${fmtDate(ms.forecast)}${ms.deadline ? `, target ${fmtDate(ms.deadline)}` : ''}`}`}
                onClick={(e) => {
                  e.stopPropagation()
                  useStore.getState().goTo({ nodeId: ms.id })
                }}
              />
            ))}
          </div>
          <div className="pg-legend">
            <span>
              <MapPin size={10} /> {cur ? cur.title : 'start'} · {fmtPct(m.progress)} done
            </span>
            <span className="plan">
              <CalendarClock size={10} /> plan: {expected ? expected.title : m.state === 'not_started' ? 'not started' : 'finished'} · {fmtPct(m.plannedProgress)}
            </span>
          </div>
        </div>
        <div className="pg-dates">
          <div>
            <span>day</span>
            <b>
              {Math.floor(m.elapsedDays)}
              <em>/{Math.round(m.totalDays)}</em>
            </b>
          </div>
          <div>
            <span>forecast</span>
            <b className={goal?.deadline && m.forecastEnd.slice(0, 10) > goal.deadline ? 'late' : ''}>{fmtDate(m.forecastEnd)}</b>
          </div>
          {goal?.deadline && (
            <div>
              <span>deadline</span>
              <b>{fmtDate(goal.deadline)}</b>
            </div>
          )}
        </div>
        <ChevronUp size={14} className={`pg-chev ${open ? 'up' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="pg-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={softSpring}>
            {m.milestones.length > 0 && (
              <div className="pg-milestones">
                {m.milestones.map((ms) => (
                  <button key={ms.id} className={`pgm ${ms.done ? 'done' : ''} ${ms.late && !ms.done ? 'late' : ''}`} onClick={() => useStore.getState().goTo({ nodeId: ms.id })}>
                    <Flag size={11} />
                    <span className="grow">{ms.title}</span>
                    <span className="faint sm">
                      {ms.done ? `reached ${fmtDate(ms.completedAt)}` : `forecast ${fmtDate(ms.forecast)}`}
                      {ms.deadline && !ms.done && ` · target ${fmtDate(ms.deadline)}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="pg-grid">
              <div className="pg-chart">
                <h5>
                  <TrendingUp size={12} /> Planned vs actual — {path.name}
                </h5>
                <BurnChart doc={doc} path={path} m={m} />
              </div>
              <div className="pg-compare">
                <h5>
                  <Flag size={12} /> All paths
                </h5>
                <ComparePaths doc={doc} onPick={(id) => useStore.getState().setFocusPath(id)} />
              </div>
            </div>
            {expected && (
              <button className="link sm" onClick={() => select(expected.id)}>
                Open the step the plan expects today →
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function pickPath(doc: PathwayDoc, focus: string | null): Path | undefined {
  const live = doc.paths.filter((p) => p.status !== 'archived')
  if (focus) return live.find((p) => p.id === focus)
  const cur = doc.nodes.find((n) => n.id === doc.currentNodeId)
  if (cur && live.find((p) => p.id === cur.pathId)?.pursuing) return live.find((p) => p.id === cur.pathId)
  const pursued = live.find((p) => p.pursuing)
  if (pursued) return pursued
  const ranks = rankByGoal(doc)
  const q = doc.goals.map((g) => ranks[g.id]?.quickest).find(Boolean)
  return live.find((p) => p.id === q) ?? live.find((p) => p.status === 'active') ?? live[0]
}

function BurnChart({ doc, path, m }: { doc: PathwayDoc; path: Path; m: PathMetrics }) {
  const W = 460
  const H = 150
  const P = 24
  const data = useMemo(() => {
    const nodes = scopeNodes(doc, path.id, null)
    const { map, total } = schedule(doc, nodes)
    const totalWork = nodes.reduce((a, n) => a + map.get(n.id)!.dur, 0) || 1
    const span = Math.max(total, m.elapsedDays, 1)
    const planned: [number, number][] = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * total
      const w = nodes.reduce((a, n) => {
        const s = map.get(n.id)!
        return s.dur ? a + s.dur * Math.min(1, Math.max(0, (t - s.es) / s.dur)) : a
      }, 0)
      planned.push([t, w / totalWork])
    }
    const completions = nodes
      .filter((n) => n.completedAt)
      .map((n) => [Math.max(0, daysBetween(doc.startDate, n.completedAt!)), map.get(n.id)!.dur / totalWork] as [number, number])
      .sort((a, b) => a[0] - b[0])
    const actual: [number, number][] = [[0, 0]]
    let acc = 0
    for (const [t, w] of completions) {
      actual.push([t, acc])
      acc += w
      actual.push([t, acc])
    }
    actual.push([Math.min(m.elapsedDays, span), m.progress])
    return { planned, actual, span }
  }, [doc, path.id, m])
  const sx = (t: number) => P + (t / data.span) * (W - P * 2)
  const sy = (v: number) => H - P - v * (H - P * 2)
  const line = (pts: [number, number][]) => pts.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  const today = sx(Math.min(m.elapsedDays, data.span))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="burn">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <line key={v} x1={P} x2={W - P} y1={sy(v)} y2={sy(v)} className="grid" />
      ))}
      <path d={line(data.planned)} className="planned" />
      <motion.path d={line(data.actual)} className="actual" style={{ stroke: path.color }} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
      {m.milestones.map((ms) => (
        <g key={ms.id} transform={`translate(${sx(ms.at * (m.totalDays || 1))}, ${H - P})`}>
          <path d="M0 0 L0 -10 L7 -7 L0 -4" className={`ms-flag ${ms.done ? 'done' : ''}`} />
        </g>
      ))}
      <line x1={today} x2={today} y1={P - 6} y2={H - P} className="today" />
      <text x={today + 4} y={P - 8} className="lbl">
        today
      </text>
      <text x={P} y={H - 6} className="lbl">
        {fmtDate(doc.startDate)}
      </text>
      <text x={W - P} y={H - 6} className="lbl" textAnchor="end">
        {fmtDate(m.plannedEnd)}
      </text>
      <g className="legend" transform={`translate(${W - P - 150}, ${P})`}>
        <line x1={0} x2={14} y1={0} y2={0} className="planned" />
        <text x={18} y={3} className="lbl">
          planned
        </text>
        <line x1={70} x2={84} y1={0} y2={0} className="actual" style={{ stroke: path.color }} />
        <text x={88} y={3} className="lbl">
          actual
        </text>
      </g>
    </svg>
  )
}

function ComparePaths({ doc, onPick }: { doc: PathwayDoc; onPick: (id: string) => void }) {
  const ranks = useMemo(() => rankByGoal(doc), [doc])
  return (
    <div className="cmp">
      {doc.goals.map((g) => {
        const r = ranks[g.id]
        if (!r?.metrics.length) return null
        const max = Math.max(...r.metrics.map((x) => x.expectedDays), 1)
        return (
          <div key={g.id} className="cmp-goal">
            {doc.goals.length > 1 && <div className="cmp-goal-title">→ {g.title}</div>}
            {[...r.metrics]
              .sort((a, b) => a.expectedDays - b.expectedDays)
              .map((x) => {
                const p = doc.paths.find((pp) => pp.id === x.pathId)!
                return (
                  <button key={x.pathId} className="cmp-row" onClick={() => onPick(x.pathId)}>
                    <span className="cmp-name">
                      <span className="dot" style={{ background: p.color }} />
                      {p.name}
                    </span>
                    <span className="cmp-bar">
                      <motion.span initial={{ width: 0 }} animate={{ width: `${(x.expectedDays / max) * 100}%` }} transition={softSpring} style={{ background: p.color }} />
                    </span>
                    <span className="cmp-num">
                      ~{fmtDays(x.expectedDays)} · {fmtPct(x.probability)}
                      {r.quickest === x.pathId && <em> quickest</em>}
                    </span>
                  </button>
                )
              })}
          </div>
        )
      })}
      <p className="hint">Expected time = the remaining critical path with each step stretched by 1 ÷ its confidence (steps that fail get retried). % = odds everything goes to plan.</p>
    </div>
  )
}
