// When a path is highlighted: the route at a glance — what's left to do on
// it, in order, and where it ends up.

import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Flag, MapPin, Target, X, Zap, Eye, AlertTriangle, Lightbulb } from 'lucide-react'
import { pathMetrics, rankByGoal, topo, scopeNodes, schedule } from '../../shared/metrics'
import { useStore } from '../store'
import { fmtDate, fmtDays, fmtPct } from '../lib/format'
import { AvatarStack, KIND_ICON, softSpring } from './ui'
import { openMenu } from './ContextMenu'

export function PathOverview() {
  const hl = useStore((s) => s.highlightPathId)
  const scope = useStore((s) => s.scope)
  const side = useStore((s) => s.side)
  return <AnimatePresence>{hl && !scope && !side && <Overview pathId={hl} key={hl} />}</AnimatePresence>
}

function Overview({ pathId }: { pathId: string }) {
  const doc = useStore((s) => s.doc)!
  const setHighlight = useStore((s) => s.setHighlight)
  const setFocus = useStore((s) => s.setFocusPath)
  const goTo = useStore((s) => s.goTo)
  const path = doc.paths.find((p) => p.id === pathId)
  const data = useMemo(() => {
    if (!path) return null
    const nodes = scopeNodes(doc, path.id, null)
    const { map } = schedule(doc, nodes)
    const ordered = topo(nodes).sort((a, b) => map.get(a.id)!.es - map.get(b.id)!.es)
    return { ordered, map, m: pathMetrics(doc, path.id), quickest: rankByGoal(doc)[path.goalId]?.quickest === path.id }
  }, [doc, path])
  if (!path || !data) return null
  const goal = doc.goals.find((g) => g.id === path.goalId)
  const { ordered, map, m } = data
  const nextId = ordered.find((n) => n.status !== 'done' && n.status !== 'skipped')?.id

  return (
    <motion.aside
      className="path-overview"
      style={{ '--c': path.color } as React.CSSProperties}
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={softSpring}
    >
      <header>
        <div className="row">
          <span className="dot" style={{ background: path.color }} />
          <b className="grow">{path.name}</b>
          {data.quickest && (
            <span className="lane-quick">
              <Zap size={10} fill="currentColor" /> quickest
            </span>
          )}
          <button className="icon-btn sm" title="Show only this path" onClick={() => setFocus(path.id)}>
            <Eye size={13} />
          </button>
          <button className="icon-btn sm" title="Clear highlight (Esc)" onClick={() => setHighlight(null)}>
            <X size={13} />
          </button>
        </div>
        {path.strategy && <p className="po-strategy">{path.strategy}</p>}
        <div className="po-stats">
          <span>
            <b>{fmtDays(m.remainingDays)}</b> left
          </span>
          <span>
            <b>{fmtPct(m.probability)}</b> likely
          </span>
          <span>
            <b>{m.done}</b>/{m.steps} done
          </span>
          {m.cost > 0 && (
            <span>
              <b>${Math.round(m.cost).toLocaleString()}</b>
            </span>
          )}
        </div>
      </header>
      <ol className="route">
        <li className="r-start">
          <span className="r-node">
            <MapPin size={10} />
          </span>
          <span className="r-title">{doc.current.title}</span>
        </li>
        {ordered.map((n, i) => {
          const Icon = n.kind === 'milestone' ? Flag : KIND_ICON[n.kind]
          const done = n.status === 'done' || n.status === 'skipped'
          const s = map.get(n.id)!
          const people = n.assignees.map((a) => doc.people.find((p) => p.id === a)).filter(Boolean) as typeof doc.people
          return (
            <motion.li
              key={n.id}
              className={`r-step ${done ? 'done' : ''} ${n.id === nextId ? 'next' : ''} ${n.id === path.currentNodeId ? 'here' : ''} ${n.kind === 'milestone' ? 'ms' : ''}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...softSpring, delay: Math.min(i, 14) * 0.025 }}
              onClick={() => goTo({ nodeId: n.id })}
              onContextMenu={(e) => openMenu(e, { kind: 'step', id: n.id })}
            >
              <span className="r-node">{done ? <Check size={10} strokeWidth={3} /> : <Icon size={10} />}</span>
              <span className="r-title">
                {n.title}
                {n.id === nextId && <em>next</em>}
              </span>
              {people.length > 0 && <AvatarStack people={people} size={16} max={2} />}
              <span className="r-when">{done ? fmtDate(n.completedAt) : `d${Math.round(s.es)}–${Math.round(s.ef)}`}</span>
            </motion.li>
          )
        })}
        <li className="r-goal">
          <span className="r-node">
            <Target size={10} />
          </span>
          <span className="r-title">{goal?.title}</span>
          <span className="r-when">{fmtDate(m.forecastEnd)}</span>
        </li>
      </ol>
      {(path.risks?.length || path.assumptions?.length) && (
        <div className="po-notes">
          {path.assumptions?.slice(0, 3).map((a, i) => (
            <div key={'a' + i}>
              <Lightbulb size={10} /> {a}
            </div>
          ))}
          {path.risks?.slice(0, 3).map((r, i) => (
            <div key={'r' + i} className="risk">
              <AlertTriangle size={10} /> {r}
            </div>
          ))}
        </div>
      )}
    </motion.aside>
  )
}
