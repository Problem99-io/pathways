import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Search as SearchIcon, Route, ListChecks, Paperclip, User, Target, Activity, Flag, CornerDownLeft } from 'lucide-react'
import type { PathwayDoc } from '../../shared/types'
import { useStore } from '../store'
import { KIND_ICON } from './ui'
import { STATUS_LABEL } from '../lib/format'

type Kind = 'path' | 'step' | 'milestone' | 'requirement' | 'reference' | 'person' | 'goal' | 'change'

interface Entry {
  key: string
  kind: Kind
  title: string
  sub: string
  /** Extra text that is searched but not shown. */
  body?: string
  color?: string
  icon: typeof Route
  go: () => void
}

const KIND_LABEL: Record<Kind, string> = {
  path: 'Paths',
  goal: 'Goals',
  milestone: 'Milestones',
  step: 'Steps',
  requirement: 'Requirements',
  reference: 'References',
  person: 'People',
  change: 'Changes & requests',
}
const ORDER: Kind[] = ['path', 'goal', 'milestone', 'step', 'requirement', 'reference', 'person', 'change']

function buildIndex(doc: PathwayDoc): Entry[] {
  const s = useStore.getState()
  const pathOf = (id: string) => doc.paths.find((p) => p.id === id)
  const trail = (id: string | null) => {
    const out: string[] = []
    while (id) {
      const n = doc.nodes.find((x) => x.id === id)
      if (!n) break
      out.unshift(n.title)
      id = n.parentId
    }
    return out
  }
  const out: Entry[] = []
  for (const p of doc.paths) {
    out.push({
      key: `p:${p.id}`,
      kind: 'path',
      title: p.name,
      sub: [p.status === 'proposed' ? 'proposal' : p.status === 'archived' ? 'archived' : null, `→ ${doc.goals.find((g) => g.id === p.goalId)?.title ?? ''}`, p.strategy].filter(Boolean).join(' · '),
      body: [p.description, ...(p.assumptions ?? []), ...(p.risks ?? [])].join(' '),
      color: p.color,
      icon: Route,
      go: () => {
        if (p.status === 'archived') s.dispatch([{ t: 'path.update', id: p.id, patch: { status: 'active' } }])
        s.goTo({ pathId: p.id })
      },
    })
  }
  for (const g of doc.goals) {
    out.push({ key: `g:${g.id}`, kind: 'goal', title: g.title, sub: g.deadline ? `deadline ${g.deadline}` : 'goal', body: g.description, color: g.color, icon: Target, go: () => s.goTo({ goalId: g.id }) })
  }
  for (const n of doc.nodes) {
    const p = pathOf(n.pathId)
    const where = [p?.name, ...trail(n.parentId)].filter(Boolean).join(' › ')
    out.push({
      key: `n:${n.id}`,
      kind: n.kind === 'milestone' ? 'milestone' : 'step',
      title: n.title,
      sub: `${where} · ${STATUS_LABEL[n.status]}`,
      body: [n.description, n.recurrence?.metric].join(' '),
      color: p?.color,
      icon: n.kind === 'milestone' ? Flag : KIND_ICON[n.kind],
      go: () => s.goTo({ nodeId: n.id }),
    })
    for (const r of n.requirements) {
      out.push({ key: `r:${r.id}`, kind: 'requirement', title: r.text, sub: `${r.done ? '✓ ' : ''}${n.title} · ${p?.name ?? ''}`, color: p?.color, icon: ListChecks, go: () => s.goTo({ nodeId: n.id }) })
    }
    for (const a of n.attachments) {
      out.push({ key: `a:${a.id}`, kind: 'reference', title: a.title, sub: `${a.type} on ${n.title}`, body: [a.text, a.url].join(' '), color: p?.color, icon: Paperclip, go: () => s.goTo({ nodeId: n.id }) })
    }
  }
  for (const a of doc.attachments) {
    out.push({ key: `a:${a.id}`, kind: 'reference', title: a.title, sub: `${a.type} · pathway reference`, body: [a.text, a.url].join(' '), icon: Paperclip, go: () => useStore.setState({ side: 'context', contextTab: 'refs' }) })
  }
  for (const p of doc.people) {
    const count = doc.nodes.filter((n) => n.assignees.includes(p.id)).length
    out.push({
      key: `u:${p.id}`,
      kind: 'person',
      title: p.name,
      sub: `${p.role ? p.role + ' · ' : ''}${count} step${count === 1 ? '' : 's'} — highlight their work`,
      color: p.color,
      icon: User,
      go: () => useStore.setState({ personFilter: p.id }),
    })
  }
  for (const sg of doc.signals) {
    out.push({ key: `s:${sg.id}`, kind: 'change', title: sg.text, sub: `${sg.kind === 'ask' ? 'request for AI' : 'change'} · ${sg.by}`, icon: Activity, go: () => useStore.setState({ side: 'context', contextTab: 'signals' }) })
  }
  return out
}

function score(e: Entry, q: string): number {
  const t = e.title.toLowerCase()
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (new RegExp(`\\b${escape(q)}`).test(t)) return 60
  if (t.includes(q)) return 45
  const words = q.split(/\s+/).filter(Boolean)
  const hay = `${t} ${e.sub.toLowerCase()} ${(e.body ?? '').toLowerCase()}`
  if (words.every((w) => hay.includes(w))) return 25 + (words.some((w) => t.includes(w)) ? 10 : 0)
  return 0
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Mark({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function Search() {
  const open = useStore((s) => s.searchOpen)
  return <AnimatePresence>{open && <Palette />}</AnimatePresence>
}

function Palette() {
  const doc = useStore((s) => s.doc)!
  const setSearch = useStore((s) => s.setSearch)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const index = useMemo(() => buildIndex(doc), [doc])
  const query = q.trim().toLowerCase()

  const results = useMemo(() => {
    if (!query) {
      // a useful default: paths, goals, milestones, then what's next
      const next = index.filter((e) => e.kind === 'step' && !/Done|Skipped/.test(e.sub)).slice(0, 6)
      return [...index.filter((e) => e.kind === 'path' || e.kind === 'goal' || e.kind === 'milestone'), ...next]
    }
    return index
      .map((e) => ({ e, s: score(e, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || ORDER.indexOf(a.e.kind) - ORDER.indexOf(b.e.kind))
      .slice(0, 60)
      .map((x) => x.e)
  }, [index, query])

  const groups = useMemo(() => {
    const g = new Map<Kind, Entry[]>()
    for (const r of results) g.set(r.kind, [...(g.get(r.kind) ?? []), r])
    return ORDER.filter((k) => g.has(k)).map((k) => ({ kind: k, items: g.get(k)! }))
  }, [results])
  const flat = groups.flatMap((g) => g.items)

  useEffect(() => setI(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.res.on')?.scrollIntoView({ block: 'nearest' })
  }, [i])

  const choose = (e?: Entry) => {
    if (!e) return
    setSearch(false)
    e.go()
  }

  return (
    <motion.div className="palette-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setSearch(false)}>
      <motion.div
        className="palette"
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pal-input">
          <SearchIcon size={16} />
          <input
            autoFocus
            placeholder="Search paths, steps, milestones, requirements, references, people…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setI((v) => Math.min(flat.length - 1, v + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setI((v) => Math.max(0, v - 1))
              } else if (e.key === 'Enter') choose(flat[i])
              else if (e.key === 'Escape') setSearch(false)
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-results" ref={listRef}>
          {groups.map((g) => (
            <div key={g.kind} className="pal-group">
              <div className="pal-group-title">{KIND_LABEL[g.kind]}</div>
              {g.items.map((e) => {
                const idx = flat.indexOf(e)
                const Icon = e.icon
                return (
                  <button key={e.key} className={`res ${idx === i ? 'on' : ''}`} onMouseMove={() => setI(idx)} onClick={() => choose(e)}>
                    <span className="res-icon" style={{ '--c': e.color ?? 'var(--muted)' } as React.CSSProperties}>
                      <Icon size={13} />
                    </span>
                    <span className="res-text">
                      <span className="res-title">
                        <Mark text={e.title} q={query} />
                      </span>
                      <span className="res-sub">{e.sub}</span>
                    </span>
                    {idx === i && <CornerDownLeft size={12} className="res-enter" />}
                  </button>
                )
              })}
            </div>
          ))}
          {!flat.length && <div className="pal-empty">Nothing matches “{q}”.</div>}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> go there
          </span>
          <span className="grow" />
          <span>
            {index.length} items in {doc.title}
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}
