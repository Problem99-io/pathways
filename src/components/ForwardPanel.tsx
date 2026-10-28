// Forward: one place to watch everything ahead of you — every goal, every
// path you're pursuing, where you are on each, and what's ready next.

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, Flag, Lock, MapPin, Play, Pause, Repeat, Target, X, Telescope, Zap, Clock, Split } from 'lucide-react'
import { forward, type ForwardStep } from '../../shared/forward'
import { rankByGoal } from '../../shared/metrics'
import { uid } from '../../shared/ops'
import type { Path } from '../../shared/types'
import { mePerson, useStore } from '../store'
import { complete, setCurrent } from '../lib/actions'
import { fmtDate, fmtDays, fmtPct, timeAgo } from '../lib/format'
import { Avatar, AvatarStack, KIND_ICON, Section, softSpring } from './ui'
import { openMenu } from './ContextMenu'

const STATE: Record<string, string> = { not_started: 'not started', ahead: 'ahead', on_track: 'on track', behind: 'behind', complete: 'complete' }

export function ForwardPanel() {
  const doc = useStore((s) => s.doc)!
  const setSide = useStore((s) => s.setSide)
  const goTo = useStore((s) => s.goTo)
  const dispatch = useStore((s) => s.dispatch)
  const mine = mePerson(doc, useStore((s) => s.me))
  const [person, setPerson] = useState<string | null>(null)
  const f = useMemo(() => forward(doc, { personId: person }), [doc, person])
  const ranks = useMemo(() => rankByGoal(doc), [doc])
  const pursue = (path: Path, on: boolean) => dispatch([{ t: 'path.pursue', id: path.id, on }])

  // fronts grouped under their goal
  const byGoal = doc.goals
    .map((g) => ({ goal: g, fronts: f.fronts.filter((x) => x.path.goalId === g.id) }))
    .filter((x) => x.fronts.length)

  return (
    <div className="panel-inner forward">
      <header className="panel-head">
        <div className="ph-row">
          <h3>
            <Telescope size={15} /> Forward
          </h3>
          <span className="faint sm">
            {f.fronts.length} front{f.fronts.length === 1 ? '' : 's'} · {doc.goals.length} goal{doc.goals.length === 1 ? '' : 's'}
          </span>
          <span className="grow" />
          <button className="icon-btn" onClick={() => setSide(null)} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <p className="hint">Everything ahead of you across every goal: where you are on each path you’re pursuing and what you can do next.</p>
        {doc.people.length > 0 && (
          <div className="fw-people">
            <button className={`chip-btn ${!person ? 'on' : ''}`} onClick={() => setPerson(null)}>
              Everyone
            </button>
            {[...doc.people].sort((a, b) => Number(b.id === mine?.id) - Number(a.id === mine?.id)).map((p) => (
              <button key={p.id} className={`chip-btn person-chip ${person === p.id ? 'on' : ''}`} onClick={() => setPerson(person === p.id ? null : p.id)}>
                <Avatar person={p} size={16} /> {p.id === mine?.id ? 'Me' : p.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="panel-body">
        {f.implicit && f.fronts.length > 0 && (
          <div className="callout info">
            <Play size={13} />
            <div>Nothing is marked as pursued yet, so every active path is shown. Press ▶ on the paths you’re actually working — the fog and pins follow them.</div>
          </div>
        )}

        {/* ---- forks waiting on you ---- */}
        {f.settle.length > 0 && (
          <Section title={`Waiting on you · ${f.settle.length}`} icon={Split}>
            <ul className="fw-list">
              {f.settle.map((r) => (
                <li key={r.node.id} className="fw-row settle" style={{ '--c': r.path.color } as React.CSSProperties} onContextMenu={(e) => openMenu(e, { kind: 'settle', id: r.node.id })}>
                  <span className="fw-icon">
                    <Split size={11} />
                  </span>
                  <button className="fw-main" onClick={() => goTo({ nodeId: r.node.id })}>
                    <span className="fw-title">{r.node.title}</span>
                    <span className="fw-sub">
                      {r.ask === 'what_happened' ? 'Done — which way did it go?' : 'Ready to decide which way to go'} · {r.path.name}
                    </span>
                  </button>
                  <button className="settle-btn" onClick={(e) => openMenu(e, { kind: 'settle', id: r.node.id })}>
                    {r.ask === 'what_happened' ? 'What happened?' : 'Decide'}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ---- fronts by goal ---- */}
        {byGoal.map(({ goal, fronts }) => (
          <div key={goal.id} className="fw-goal" style={{ '--g': goal.color } as React.CSSProperties}>
            <div className="fw-goal-head">
              <Target size={13} />
              <b>{goal.title}</b>
              {goal.deadline && <span className="faint sm">by {fmtDate(goal.deadline)}</span>}
            </div>
            {fronts.map((fr, i) => {
              const quick = ranks[goal.id]?.quickest === fr.path.id
              const m = fr.metrics
              return (
                <motion.div
                  key={fr.path.id}
                  className="front"
                  onContextMenu={(e) => openMenu(e, { kind: 'path', id: fr.path.id })}
                  style={{ '--c': fr.path.color } as React.CSSProperties}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...softSpring, delay: i * 0.04 }}
                >
                  <div className="front-head">
                    <span className="dot" style={{ background: fr.path.color }} />
                    <button className="front-name" onClick={() => goTo({ pathId: fr.path.id })}>
                      {fr.path.name}
                    </button>
                    {quick && <Zap size={11} className="quick" fill="currentColor" />}
                    <span className={`pg-state s-${m.state}`}>
                      {m.state === 'ahead' || m.state === 'behind' ? `${fmtDays(Math.abs(m.varianceDays))} ${STATE[m.state]}` : STATE[m.state]}
                    </span>
                    <span className="grow" />
                    {!f.implicit && (
                      <button className="icon-btn sm" title="Stop pursuing this path" onClick={() => pursue(fr.path, false)}>
                        <Pause size={12} />
                      </button>
                    )}
                    {f.implicit && (
                      <button className="icon-btn sm pursue" title="Pursue this path" onClick={() => pursue(fr.path, true)}>
                        <Play size={12} />
                      </button>
                    )}
                  </div>
                  <div className="front-bar">
                    <span style={{ width: `${m.progress * 100}%` }} />
                    <i style={{ left: `${m.plannedProgress * 100}%` }} />
                  </div>
                  <button className="front-here" onClick={() => (fr.here ? goTo({ nodeId: fr.here.id }) : goTo({ pathId: fr.path.id }))}>
                    <MapPin size={11} />
                    <span className="grow">{fr.here ? fr.here.title : 'At the start'}</span>
                    <span className="faint sm">
                      {m.futures ? `~${fmtDays(m.futures.expectedDays)} · ${m.futures.scenarios.length} futures` : `${fmtDays(m.remainingDays)} left`} · {fmtPct(m.probability)}
                    </span>
                  </button>
                  {fr.milestone && (
                    <button className={`front-ms ${fr.milestone.late ? 'late' : ''}`} onClick={() => goTo({ nodeId: fr.milestone!.id })}>
                      <Flag size={11} />
                      <span className="grow">{fr.milestone.title}</span>
                      <span className="sm">
                        {fr.milestone.late ? 'late · ' : ''}forecast {fmtDate(fr.milestone.forecast)}
                      </span>
                    </button>
                  )}
                  {fr.ready.length === 0 && fr.loops.length === 0 && <div className="faint sm front-empty">Nothing ready on this path{person ? ' for this person' : ''}.</div>}
                </motion.div>
              )
            })}
          </div>
        ))}

        {/* ---- ready now ---- */}
        <Section title={`Ready to do · ${f.ready.length}`} icon={Play}>
          <ul className="fw-list">
            <AnimatePresence initial={false}>
              {f.ready.map((r) => (
                <StepRow key={r.node.id} r={r} />
              ))}
            </AnimatePresence>
            {!f.ready.length && <li className="faint sm">Nothing is ready to start right now.</li>}
          </ul>
        </Section>

        {/* ---- loops ---- */}
        {f.loops.length > 0 && (
          <Section title={`Ongoing loops · ${f.loops.length}`} icon={Repeat}>
            <ul className="fw-list">
              {f.loops.map((l) => {
                const rec = l.node.recurrence
                return (
                  <li key={l.node.id} className="fw-row loop" onContextMenu={(e) => openMenu(e, { kind: 'step', id: l.node.id })} style={{ '--c': l.path.color } as React.CSSProperties}>
                    <span className="fw-icon">
                      <Repeat size={11} className="spin-slow" />
                    </span>
                    <button className="fw-main" onClick={() => goTo({ nodeId: l.node.id })}>
                      <span className="fw-title">{l.node.title}</span>
                      <span className="fw-sub">
                        {l.path.name} · {rec?.cadence}
                        {rec?.metric && ` · ${rec.current ?? 0}${rec.target ? ` / ${rec.target}` : ''} ${rec.metric}`}
                      </span>
                    </button>
                    <span className={`fw-due ${l.overdue ? 'late' : ''}`}>
                      <Clock size={10} /> {l.overdue ? `due ${timeAgo(l.dueAt).replace(' ago', '')} ago` : `next ${fmtDate(l.dueAt)}`}
                    </span>
                    <button
                      className="icon-btn sm act"
                      title="Log a cycle"
                      onClick={() => dispatch([{ t: 'cycle.log', id: l.node.id, cycle: { id: uid(), at: new Date().toISOString() } }])}
                    >
                      <Repeat size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}

        {/* ---- coming up ---- */}
        {f.fronts.some((x) => x.upcoming.length) && (
          <Section title="Coming up next" icon={ArrowRight}>
            <ul className="fw-list">
              {f.fronts.flatMap((x) => x.upcoming).map((r) => (
                <StepRow key={r.node.id} r={r} muted />
              ))}
            </ul>
          </Section>
        )}

        {f.blocked.length > 0 && (
          <Section title={`Blocked · ${f.blocked.length}`} icon={Lock}>
            <ul className="fw-list">
              {f.blocked.map((r) => (
                <StepRow key={r.node.id} r={r} muted />
              ))}
            </ul>
          </Section>
        )}

        {/* ---- other paths ---- */}
        {f.idle.length > 0 && (
          <Section title="Other paths you could take" icon={Telescope}>
            <ul className="fw-list">
              {f.idle.map(({ path, goal, metrics }) => (
                <li key={path.id} className="fw-row idle" onContextMenu={(e) => openMenu(e, { kind: 'path', id: path.id })} style={{ '--c': path.color } as React.CSSProperties}>
                  <span className="dot" style={{ background: path.color }} />
                  <button className="fw-main" onClick={() => goTo({ pathId: path.id })}>
                    <span className="fw-title">
                      {path.name}
                      {path.status === 'proposed' && <span className="tag-ai">proposal</span>}
                    </span>
                    <span className="fw-sub">
                      → {goal?.title} · ~{fmtDays(metrics.expectedDays)} · {fmtPct(metrics.probability)}
                    </span>
                  </button>
                  <button className="btn xs" onClick={() => pursue(path, true)} title="Start pursuing this path alongside the others">
                    <Play size={11} /> Pursue
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  )
}

function StepRow({ r, muted }: { r: ForwardStep; muted?: boolean }) {
  const doc = useStore((s) => s.doc)!
  const goTo = useStore((s) => s.goTo)
  const Icon = r.node.kind === 'milestone' ? Flag : KIND_ICON[r.node.kind]
  const people = r.node.assignees.map((a) => doc.people.find((p) => p.id === a)).filter(Boolean) as typeof doc.people
  const here = r.path.currentNodeId === r.node.id
  return (
    <motion.li
      layout
      className={`fw-row ${muted ? 'muted' : ''} ${here ? 'here' : ''}`}
      onContextMenu={(e) => openMenu(e, { kind: 'step', id: r.node.id })}
      style={{ '--c': r.path.color } as React.CSSProperties}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10, height: 0 }}
      transition={softSpring}
    >
      <span className="fw-icon">
        <Icon size={11} />
      </span>
      <button className="fw-main" onClick={() => goTo({ nodeId: r.node.id })}>
        <span className="fw-title">{r.node.title}</span>
        <span className="fw-sub">
          {[r.path.name, ...r.trail].join(' › ')}
          {r.goal && ` → ${r.goal.title}`}
        </span>
      </button>
      {people.length > 0 && <AvatarStack people={people} size={16} max={2} />}
      {r.plannedEnd && <span className={`fw-due ${r.late ? 'late' : ''}`}>{r.late ? 'late' : fmtDate(r.plannedEnd)}</span>}
      {!muted && (
        <span className="fw-acts">
          {!here && (
            <button className="icon-btn sm act" title="I’m working on this" onClick={() => setCurrent(r.node.id)}>
              <MapPin size={12} />
            </button>
          )}
          <button className="icon-btn sm act ok" title="Complete" onClick={() => complete(r.node)}>
            <Check size={12} />
          </button>
        </span>
      )}
    </motion.li>
  )
}
