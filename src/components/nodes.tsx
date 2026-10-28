import { memo, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarClock, Check, ChevronDown, Zap, Flag, Play, Pause, CornerDownRight, Layers, Lock, Paperclip, Plus, Repeat, Sparkles, Target, MapPin, Split } from 'lucide-react'
import { openMenu } from './ContextMenu'
import type { GhostData, GoalData, LaneData, StartData, StepData } from '../lib/layout'
import { AvatarStack, KIND_ICON, softSpring } from './ui'
import { fmtDate, fmtDays, fmtPct, KIND_LABEL } from '../lib/format'
import { addNext, addParallel, addStep, drillInto, pursue } from '../lib/actions'
import { useStore } from '../store'

const enter = { initial: { opacity: 0, scale: 0.86, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: softSpring }

export const StepNode = memo(function StepNode({ data, selected }: NodeProps<Node<StepData, 'step'>>) {
  const { node: n, path, kids } = data
  const Icon = KIND_ICON[n.kind]
  const reqDone = n.requirements.filter((r) => r.done).length
  const kidsDone = kids.filter((k) => k.status === 'done').length
  const toggle = useStore((s) => s.toggleExpanded)
  const rec = n.recurrence
  const cls = [
    'node',
    `kind-${n.kind}`,
    `status-${n.status}`,
    selected && 'selected',
    data.current && 'current',
    data.next && 'next',
    data.past && 'past',
    data.proposed && 'proposed',
    data.dimmed && 'dimmed',
    data.expected && 'expected',
    data.hl && `hl-${data.hl}`,
    data.fate !== 'live' && `fate-${data.fate}`,
    data.fork && 'is-fork',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <motion.div className={cls} data-fog={data.fog} style={{ '--c': path.color } as React.CSSProperties} {...enter}>
      <Handle type="target" position={Position.Left} className="handle" />
      {data.expected && (
        <div className="plan-flag" title="According to the plan you should be on this step today">
          <CalendarClock size={10} /> plan says here
        </div>
      )}
      {data.fate === 'gone' ? (
        <div className="gone-flag" title="This future didn’t happen">didn’t happen</div>
      ) : (
        data.next && !data.current && <div className="next-flag">next</div>
      )}
      {data.order !== null && <div className="route-num">{data.order}</div>}
      {n.kind === 'milestone' && <div className="ms-glow" />}

      <div className="node-top">
        <span className="kind-icon">
          <Icon size={12} strokeWidth={2.2} />
        </span>
        <span className="kind-label">{KIND_LABEL[n.kind]}</span>
        {rec && <span className="cadence">{rec.cadence}</span>}
        <span className="grow" />
        <span className="dur">{n.kind === 'milestone' && !n.durationDays ? '◆' : fmtDays(n.durationDays)}</span>
        <span className={`status-dot s-${n.status}`} title={n.status}>
          {n.status === 'done' && <Check size={9} strokeWidth={3.5} />}
          {n.status === 'blocked' && <Lock size={8} strokeWidth={3} />}
        </span>
      </div>

      <div className="node-title">{n.title}</div>

      {data.fork ? (
        <div className={`fork-meta ${data.fork.needs ? 'needs' : ''}`}>
          <Split size={11} />
          {data.fork.resolved ? (
            <span className="grow">
              {data.fork.mode === 'chance' ? 'went' : 'chose'}: <b>{data.fork.resolved}</b>
            </span>
          ) : (
            <span className="grow">
              {data.fork.count} possible {data.fork.mode === 'chance' ? 'futures' : 'options'}
              {data.fork.range && (
                <span className="faint">
                  {' '}
                  · {Math.round(data.fork.range[0])}–{Math.round(data.fork.range[1])}d
                </span>
              )}
            </span>
          )}
          {data.fork.needs && (
            <button
              className="settle-btn nodrag"
              onClick={(e) => {
                e.stopPropagation()
                openMenu(e, { kind: 'settle', id: n.id })
              }}
            >
              {data.fork.needs === 'what_happened' ? 'What happened?' : 'Decide'}
            </button>
          )}
        </div>
      ) : n.kind === 'milestone' ? (
        <div className="ms-meta">
          <Flag size={11} />
          <span>intermediate goal</span>
          {n.deadline && <span className="ms-date">by {fmtDate(n.deadline)}</span>}
        </div>
      ) : rec ? (
        <div className="loop-meta">
          <svg className="loop-orbit" viewBox="0 0 24 24" width="22" height="22">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
            <circle className="loop-arc" cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="14 40" />
          </svg>
          <span>
            {rec.cycles.length} cycle{rec.cycles.length === 1 ? '' : 's'}
            {rec.metric && (
              <>
                {' · '}
                <b>{rec.current ?? '0'}</b>
                {rec.target ? ` / ${rec.target}` : ''} {rec.metric}
              </>
            )}
          </span>
        </div>
      ) : (
        <div className="confidence" title={`${Math.round(n.confidence * 100)}% confidence`}>
          <span style={{ width: `${n.confidence * 100}%` }} />
        </div>
      )}

      <div className="node-foot">
        {data.people.length > 0 && <AvatarStack people={data.people} size={20} />}
        {n.requirements.length > 0 && (
          <span className={`chip ${reqDone === n.requirements.length ? 'ok' : ''}`} title="Requirements">
            <Check size={10} />
            {reqDone}/{n.requirements.length}
          </span>
        )}
        {n.attachments.length > 0 && (
          <span className="chip" title="References">
            <Paperclip size={10} />
            {n.attachments.length}
          </span>
        )}
        {n.createdBy === 'ai' && (
          <span className="chip ai" title="Suggested by AI">
            <Sparkles size={10} />
          </span>
        )}
        <span className="grow" />
        {data.reach !== null &&
          (data.reach > 0.004 ? (
            <span className="chip odds" title={`${Math.round(data.reach * 100)}% chance this step happens at all`} style={{ '--p': data.reach } as React.CSSProperties}>
              <i />
              {Math.round(data.reach * 100)}%
            </span>
          ) : (
            data.fate === 'alt' && (
              <span className="chip alt-chip" title="On an option the plan isn’t taking right now">
                option
              </span>
            )
          ))}
        {data.due && data.fate === 'live' && <span className={`due ${data.due.late ? 'late' : ''}`}>{data.due.label}</span>}
        {kids.length > 0 && (
          <button
            className={`chip kids nodrag ${data.expanded ? 'open' : ''}`}
            title="Show sub-steps"
            onClick={(e) => {
              e.stopPropagation()
              toggle(n.id)
            }}
          >
            <Layers size={10} />
            {kidsDone}/{kids.length}
            <ChevronDown size={10} className="chev" />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {data.expanded && kids.length > 0 && (
          <motion.ul className="kids-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={softSpring}>
            {kids.slice(0, 6).map((k) => (
              <li key={k.id} className={`s-${k.status}`}>
                <span className={`status-dot sm s-${k.status}`}>{k.status === 'done' && <Check size={7} strokeWidth={4} />}</span>
                <span className="kid-title">{k.title}</span>
                <span className="kid-dur">{fmtDays(k.durationDays)}</span>
              </li>
            ))}
            <li className="kids-open">
              <button
                className="nodrag"
                onClick={(e) => {
                  e.stopPropagation()
                  drillInto(n)
                }}
              >
                <CornerDownRight size={11} /> Open sub-path
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>

      <button
        className="add-btn right nodrag"
        title="Add next step (Tab)"
        onClick={(e) => {
          e.stopPropagation()
          addNext(n)
        }}
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>
      <button
        className="add-btn bottom nodrag"
        title="Add a parallel step"
        onClick={(e) => {
          e.stopPropagation()
          addParallel(n)
        }}
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>
      <Handle type="source" position={Position.Right} className="handle" />
    </motion.div>
  )
})

export const StartNode = memo(function StartNode({ data }: NodeProps<Node<StartData, 'start'>>) {
  const inner = data.inner
  return (
    <motion.div className={`node-start ${data.current ? 'current' : ''} ${inner ? 'inner' : ''}`} {...enter}>
      <div className="start-label">
        {inner ? (
          <>
            <Layers size={11} /> inside
          </>
        ) : (
          <>
            <span className="pulse-dot" /> where you are now
          </>
        )}
      </div>
      <div className="start-title">{data.title || 'Describe where you are'}</div>
      {data.description && <div className="start-desc">{data.description}</div>}
      <Handle type="source" position={Position.Right} className="handle" />
      <Handle type="target" position={Position.Bottom} id="loop-in" className="handle hidden" />
    </motion.div>
  )
})

export const GoalNode = memo(function GoalNode({ data }: NodeProps<Node<GoalData, 'goal'>>) {
  const g = data.goal
  if (data.inner) {
    return (
      <motion.div className={`node-goal inner ${data.loop ? 'loop' : ''}`} {...enter}>
        <Handle type="target" position={Position.Left} className="handle" />
        <div className="goal-label">
          {data.loop ? <Repeat size={11} className="spin-slow" /> : <Check size={11} />}
          {data.loop ? `repeat ${data.inner.recurrence?.cadence ?? ''}` : 'step complete'}
        </div>
        <div className="goal-title">{data.loop ? 'Next cycle' : data.inner.title}</div>
        {data.loop && data.inner.recurrence?.metric && (
          <div className="goal-best">
            grow <b>{data.inner.recurrence.metric}</b>
            {data.inner.recurrence.target && <> → {data.inner.recurrence.target}</>}
          </div>
        )}
        <Handle type="source" position={Position.Bottom} id="loop-out" className="handle hidden" />
      </motion.div>
    )
  }
  return (
    <motion.div className={`node-goal ${data.hl ? `hl-${data.hl}` : ''}`} style={{ '--g': g?.color } as React.CSSProperties} {...enter}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="goal-glow" />
      <div className="goal-label">
        <Target size={11} /> goal
        {g?.deadline && <span className="goal-deadline">by {fmtDate(g.deadline)}</span>}
      </div>
      <div className="goal-title">{g?.title}</div>
      {data.best ? (
        <div className="goal-best">
          <span className="dot" style={{ background: data.best.color }} />
          quickest: <b>{data.best.name}</b> · ~{fmtDays(data.best.days)}
          {data.best.meets !== undefined && <span className={`meets ${data.best.meets ? 'ok' : 'late'}`}>{data.best.meets ? 'on time' : 'misses deadline'}</span>}
        </div>
      ) : (
        <div className="goal-best muted">{data.paths ? 'add steps to forecast' : 'no paths yet'}</div>
      )}
    </motion.div>
  )
})

export const GhostNode = memo(function GhostNode({ data }: NodeProps<Node<GhostData, 'ghost'>>) {
  return (
    <motion.button
      className="node-ghost nodrag"
      style={{ '--c': data.path.color } as React.CSSProperties}
      {...enter}
      onClick={(e) => {
        e.stopPropagation()
        addStep({ pathId: data.path.id, parentId: null, title: 'First step' })
      }}
    >
      <Handle type="target" position={Position.Left} className="handle" />
      <Plus size={14} /> Add the first step of <b>{data.path.name}</b>
      <Handle type="source" position={Position.Right} className="handle" />
    </motion.button>
  )
})

/** The path's name, floating above its lane. Click to highlight, double-click to rename. */
export const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<LaneData, 'lane'>>) {
  const { path, metrics: m } = data
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(path.name)
  const dispatch = useStore((s) => s.dispatch)
  const commit = () => {
    setEditing(false)
    if (name.trim() && name !== path.name) dispatch([{ t: 'path.update', id: path.id, patch: { name: name.trim() } }])
    else setName(path.name)
  }
  return (
    <motion.div
      className={`lane-label ${data.hl ? `hl-${data.hl}` : ''} ${path.status === 'proposed' ? 'proposed' : ''}`}
      style={{ '--c': path.color } as React.CSSProperties}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={softSpring}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setName(path.name)
        setEditing(true)
      }}
      title={path.strategy || 'Click to highlight · double-click to rename'}
    >
      <span className="lane-dot" />
      {editing ? (
        <input
          className="lane-input nodrag"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setName(path.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <span className="lane-name">{path.name}</span>
      )}
      {path.status === 'proposed' && <span className="tag-ai">proposal</span>}
      <button
        className={`lane-pursue nodrag ${path.pursuing ? 'on' : ''}`}
        title={path.pursuing ? 'You are pursuing this path. Click to pause it' : 'Pursue this path: track where you are on it'}
        onClick={(e) => {
          e.stopPropagation()
          pursue(path.id, !path.pursuing)
        }}
      >
        {path.pursuing ? (
          <>
            <span className="pulse" /> pursuing{data.here ? ` · at ${data.here.title}` : ' · at start'}
            <Pause size={9} className="lp-hover" />
          </>
        ) : (
          <>
            <Play size={9} /> pursue
          </>
        )}
      </button>
      {data.quickest && (m?.steps ?? 0) > 0 && (
        <span className="lane-quick">
          <Zap size={10} fill="currentColor" /> quickest
        </span>
      )}
      {m && m.steps > 0 && (
        <span className="lane-metrics">
          {m.futures ? `~${fmtDays(m.futures.expectedDays)} expected` : `${fmtDays(m.remainingDays)} left`} · {fmtPct(m.probability)} likely · {m.done}/{m.steps} done
        </span>
      )}
      {m?.futures && (
        <span
          className="lane-futures"
          title={m.futures.scenarios
            .slice(0, 6)
            .map((f) => `${Math.round(f.probability * 100)}% · ${f.outcomes.map((o) => o.label).join(' → ') || 'as planned'} · ~${Math.round(f.days)}d`)
            .join('\n')}
        >
          <Split size={10} /> {m.futures.scenarios.length} futures · {fmtDays(m.futures.bestDays)}–{fmtDays(m.futures.worstDays)}
        </span>
      )}
      {data.multiGoal && data.goal && (
        <span className="lane-goal">
          <Target size={10} /> {data.goal.title}
        </span>
      )}
      {path.strategy && <span className="lane-strategy">{path.strategy}</span>}
    </motion.div>
  )
})

export function YouAreHerePin({ label }: { label?: string }) {
  return (
    <div className="you-pin">
      <MapPin size={11} strokeWidth={2.5} /> you are here
      {label && <span className="pin-path">{label}</span>}
    </div>
  )
}

export const nodeTypes = { step: StepNode, start: StartNode, goal: GoalNode, ghost: GhostNode, lane: LaneNode }
