import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  Archive,
  Check,
  ChevronRight,
  CloudOff,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  X,
  Zap,
  Compass,
  Users,
  RefreshCw,
  Search as SearchIcon,
  Focus,
  Telescope,
  Play,
  Pause,
} from 'lucide-react'
import { rankByGoal, pathMetrics } from '../../shared/metrics'
import { uid } from '../../shared/ops'
import { PATH_COLORS, type Path } from '../../shared/types'
import { mePerson, useStore } from '../store'
import { fmtDays, fmtPct } from '../lib/format'
import { newPath, pursue } from '../lib/actions'
import { forward } from '../../shared/forward'
import { Avatar, EditableText, spring, useClickOutside } from './ui'
import { useGit } from './SyncPanel'
import { openMenu } from './ContextMenu'
import { WhoAmI } from './WhoAmI'

export function TopBar() {
  const doc = useStore((s) => s.doc)!
  const scope = useStore((s) => s.scope)
  const enter = useStore((s) => s.enter)
  const dispatch = useStore((s) => s.dispatch)

  const crumbs = useMemo(() => {
    const out = []
    let id = scope
    while (id) {
      const n = doc.nodes.find((x) => x.id === id)
      if (!n) break
      out.unshift(n)
      id = n.parentId
    }
    return out
  }, [doc, scope])

  return (
    <div className="topbar">
      <div className="tb-left">
        <a className="icon-btn" href="#/" title="All pathways">
          <ArrowLeft size={16} />
        </a>
        <div className="tb-title">
          <EditableText value={doc.title} onCommit={(title) => title.trim() && dispatch([{ t: 'pathway.update', patch: { title } }])} className="title-input" />
          <AnimatePresence>
            {crumbs.length > 0 && (
              <motion.div className="crumbs" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <button onClick={() => enter(null)}>Overview</button>
                {crumbs.map((c, i) => (
                  <span key={c.id} className="crumb">
                    <ChevronRight size={12} />
                    <button className={i === crumbs.length - 1 ? 'here' : ''} onClick={() => enter(c.id)}>
                      {c.title}
                    </button>
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {!scope && <PathChips />}
      <TopActions />
    </div>
  )
}

function PathChips() {
  const doc = useStore((s) => s.doc)!
  const focus = useStore((s) => s.focusPathId)
  const highlight = useStore((s) => s.highlightPathId)
  const setFocus = useStore((s) => s.setFocusPath)
  const setHighlight = useStore((s) => s.setHighlight)
  const ranks = useMemo(() => rankByGoal(doc), [doc])
  const quickest = new Set(Object.values(ranks).map((r) => r.quickest))
  const paths = doc.paths.filter((p) => p.status !== 'archived')
  const archived = doc.paths.filter((p) => p.status === 'archived')
  const multiGoal = doc.goals.length > 1

  return (
    <div className="path-chips">
      <button
        className={`pchip all ${focus === null && !highlight ? 'on' : ''}`}
        onClick={() => {
          setFocus(null)
          setHighlight(null)
        }}
      >
        {focus === null && !highlight && <motion.span layoutId="pchip-on" className="pchip-bg" transition={spring} />}
        <span className="pchip-in">All paths</span>
      </button>
      {paths.map((p) => (
        <PathChip key={p.id} path={p} on={focus === p.id || highlight === p.id} isolated={focus === p.id} quickest={quickest.has(p.id)} goalName={multiGoal ? doc.goals.find((g) => g.id === p.goalId)?.title : undefined} />
      ))}
      <button className="pchip add" title="New path" onClick={() => newPath(doc.goals[0]?.id)}>
        <Plus size={13} />
      </button>
      {archived.length > 0 && <ArchivedMenu paths={archived} />}
    </div>
  )
}

function PathChip({ path, on, isolated, quickest, goalName }: { path: Path; on: boolean; isolated: boolean; quickest: boolean; goalName?: string }) {
  const doc = useStore((s) => s.doc)!
  const setFocus = useStore((s) => s.setFocusPath)
  const goTo = useStore((s) => s.goTo)
  const setHighlight = useStore((s) => s.setHighlight)
  const dispatch = useStore((s) => s.dispatch)
  const m = useMemo(() => pathMetrics(doc, path.id), [doc, path.id])
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const proposed = path.status === 'proposed'
  return (
    <div className={`pchip-wrap ${proposed ? 'proposed' : ''}`} ref={wrapRef} onContextMenu={(e) => openMenu(e, { kind: 'path', id: path.id })}>
      <button
        className={`pchip ${on ? 'on' : ''} ${isolated ? 'isolated' : ''}`}
        onClick={() => {
          if (isolated) setFocus(null)
          else if (on) setHighlight(null)
          else goTo({ pathId: path.id })
        }}
        onDoubleClick={() => setFocus(path.id)}
        title={`${path.strategy || path.name}${goalName ? `\n→ ${goalName}` : ''}\nClick to highlight · double-click to show only this path`}
      >
        {on && <motion.span layoutId="pchip-on" className="pchip-bg" transition={spring} />}
        <span className="pchip-in">
          <span className={`dot ${path.pursuing ? 'pursuing' : ''}`} style={{ background: path.color, '--c': path.color } as React.CSSProperties} />
          <span className="pchip-name">{path.name}</span>
          {m.steps > 0 && (
            <span className="pchip-metrics">
              {fmtDays(m.remainingDays)} · {fmtPct(m.probability)}
            </span>
          )}
          {quickest && m.steps > 0 && (
            <span className="quick" title="Quickest expected route to this goal">
              <Zap size={10} fill="currentColor" />
            </span>
          )}
          {proposed && <span className="tag-ai">proposal</span>}
          {isolated && <Focus size={11} className="iso" />}
        </span>
      </button>
      {proposed && (
        <>
          <button className="pchip-act ok" title="Accept this path" onClick={() => dispatch([{ t: 'path.update', id: path.id, patch: { status: 'active' } }])}>
            <Check size={12} />
          </button>
          <button className="pchip-act no" title="Discard this proposal" onClick={() => dispatch([{ t: 'path.delete', id: path.id }])}>
            <X size={12} />
          </button>
        </>
      )}
      <button className="pchip-act" title="Path options" onClick={() => setMenu((v) => (v ? null : wrapRef.current!.getBoundingClientRect()))}>
        <MoreHorizontal size={13} />
      </button>
      {createPortal(<AnimatePresence>{menu && <PathMenu path={path} isolated={isolated} anchor={menu} onClose={() => setMenu(null)} />}</AnimatePresence>, document.body)}
    </div>
  )
}

const menuPos = (r: DOMRect): React.CSSProperties => ({ position: 'fixed', top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 270)) })

function PathMenu({ path, isolated, anchor, onClose }: { path: Path; isolated: boolean; anchor: DOMRect; onClose: () => void }) {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const setFocus = useStore((s) => s.setFocusPath)
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState(false)
  useClickOutside(ref, onClose)
  const patch = (p: Partial<Path>) => dispatch([{ t: 'path.update', id: path.id, patch: p }])
  return (
    <motion.div ref={ref} className="menu" style={menuPos(anchor)} initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={spring}>
      <div className="menu-pad">
        <EditableText value={path.name} onCommit={(name) => name.trim() && patch({ name })} className="menu-input" />
        <EditableText value={path.strategy ?? ''} onCommit={(strategy) => patch({ strategy })} placeholder="The bet this path makes…" multiline className="menu-input sm" />
        <div className="swatches">
          {PATH_COLORS.map((c) => (
            <button key={c} className={`swatch ${c === path.color ? 'on' : ''}`} style={{ background: c }} onClick={() => patch({ color: c })} />
          ))}
        </div>
        {doc.goals.length > 1 && (
          <label className="menu-row">
            <span>Leads to</span>
            <select value={path.goalId} onChange={(e) => patch({ goalId: e.target.value })}>
              {doc.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {(path.assumptions?.length || path.risks?.length) && (
          <div className="menu-notes">
            {path.assumptions?.map((a, i) => <div key={'a' + i}>• {a}</div>)}
            {path.risks?.map((r, i) => (
              <div key={'r' + i} className="risk">
                ⚠ {r}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => {
          pursue(path.id, !path.pursuing)
          onClose()
        }}
      >
        {path.pursuing ? <Pause size={13} /> : <Play size={13} />} {path.pursuing ? 'Stop pursuing' : 'Pursue this path'}
      </button>
      <button
        className="menu-item"
        onClick={() => {
          setFocus(isolated ? null : path.id)
          onClose()
        }}
      >
        <Focus size={13} /> {isolated ? 'Show all paths' : 'Show only this path'}
      </button>
      <button
        className="menu-item"
        onClick={() => {
          const newId = uid()
          dispatch([{ t: 'path.fork', id: path.id, newId, name: `${path.name} (copy)` }])
          onClose()
        }}
      >
        <Copy size={13} /> Duplicate path
      </button>
      {path.status !== 'proposed' && (
        <button className="menu-item" onClick={() => patch({ status: 'proposed' })}>
          <GitBranch size={13} /> Mark as proposal
        </button>
      )}
      <button
        className="menu-item"
        onClick={() => {
          patch({ status: 'archived' })
          onClose()
        }}
      >
        <Archive size={13} /> Archive
      </button>
      <button className={`menu-item danger ${confirm ? 'armed' : ''}`} onClick={() => (confirm ? dispatch([{ t: 'path.delete', id: path.id }]) : setConfirm(true))}>
        <Trash2 size={13} /> {confirm ? 'Click again to delete' : 'Delete path'}
      </button>
    </motion.div>
  )
}

function ArchivedMenu({ paths }: { paths: Path[] }) {
  const [open, setOpen] = useState<DOMRect | null>(null)
  const dispatch = useStore((s) => s.dispatch)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(null), !!open)
  return (
    <div className="pchip-wrap">
      <button className="pchip add" title="Archived paths" onClick={(e) => setOpen((v) => (v ? null : e.currentTarget.getBoundingClientRect()))}>
        <Archive size={12} />
        <span className="count">{paths.length}</span>
      </button>
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div ref={ref} className="menu" style={menuPos(open)} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {paths.map((p) => (
              <button key={p.id} className="menu-item" onClick={() => dispatch([{ t: 'path.update', id: p.id, patch: { status: 'active' } }])}>
                <span className="dot" style={{ background: p.color }} /> Restore {p.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}

function TopActions() {
  const doc = useStore((s) => s.doc)!
  const fog = useStore((s) => s.fog)
  const toggleFog = useStore((s) => s.toggleFog)
  const side = useStore((s) => s.side)
  const setSide = useStore((s) => s.setSide)
  const personFilter = useStore((s) => s.personFilter)
  const mine = mePerson(doc, useStore((s) => s.me))?.id
  const setPersonFilter = useStore((s) => s.setPersonFilter)
  const git = useGit()
  const lastAi = [...doc.activity].reverse().find((a) => a.actor.type === 'ai')
  const aiRecent = lastAi && Date.now() - new Date(lastAi.at).getTime() < 5 * 60_000
  const openAsks = doc.signals.filter((s) => s.kind === 'ask' && !s.resolved).length
  const gs = git?.status
  const pending = gs ? gs.dirty + gs.ahead + gs.behind : 0
  const readyCount = useMemo(() => forward(doc).ready.length, [doc])

  return (
    <div className="tb-right">
      <button className="tool search" onClick={() => useStore.getState().setSearch(true)} title="Search (⌘K)">
        <SearchIcon size={15} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="tb-sep" />
      <div className="people-filter">
        {doc.people.slice(0, 5).map((p) => (
          <button key={p.id} className={`pf ${personFilter === p.id ? 'on' : ''} ${personFilter && personFilter !== p.id ? 'off' : ''}`} onClick={() => setPersonFilter(p.id)} title={`Highlight ${p.name}'s steps${p.id === mine ? ' (you)' : ''}`}>
            <Avatar person={p} size={24} ring={personFilter === p.id} />
          </button>
        ))}
        <button className="icon-btn" title="Team" onClick={() => setSide('context', 'team')}>
          <Users size={15} />
        </button>
      </div>
      <div className="tb-sep" />
      <button className={`tool forward-btn ${side === 'forward' ? 'on' : ''}`} onClick={() => setSide('forward')} title="Forward: what's next across every goal (W)">
        <Telescope size={15} />
        <span>Forward</span>
        {readyCount > 0 && <span className="badge fw">{readyCount}</span>}
      </button>
      <button className={`tool ${fog ? 'on' : ''}`} onClick={toggleFog} title="Focus fog (F)">
        {fog ? <EyeOff size={15} /> : <Eye size={15} />}
        <span>Focus</span>
      </button>
      <button className={`tool ${side === 'context' ? 'on' : ''}`} onClick={() => setSide('context')} title="Where you are, goals, context">
        <Compass size={15} />
        <span>Context</span>
      </button>
      <button className={`tool ai ${side === 'ai' ? 'on' : ''}`} onClick={() => setSide('ai')} title="Chat with Claude">
        <Sparkles size={15} />
        <span>Claude</span>
        {(aiRecent || openAsks > 0) && <span className="live-dot" />}
      </button>
      <button className={`tool ${side === 'sync' ? 'on' : ''}`} onClick={() => setSide('sync')} title="Git sync">
        {gs?.repo ? <RefreshCw size={15} className={gs.busy ? 'spin' : ''} /> : <CloudOff size={15} />}
        <span>Sync</span>
        {pending > 0 && <span className="badge">{pending}</span>}
        {gs?.lastError && <span className="live-dot err" />}
      </button>
      <div className="tb-sep" />
      <WhoAmI />
    </div>
  )
}
