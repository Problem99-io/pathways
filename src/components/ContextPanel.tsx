import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Compass, MapPin, Target, Plus, Trash2, Zap, Activity, MessageSquarePlus, Check, X, Sparkles, RotateCcw, Play, Pause } from 'lucide-react'
import { rankByGoal, pathMetrics } from '../../shared/metrics'
import { uid } from '../../shared/ops'
import { GOAL_COLORS, PERSON_COLORS } from '../../shared/types'
import { myName, useStore, type ContextTab } from '../store'
import { fmtDate, fmtDays, fmtPct, timeAgo } from '../lib/format'
import { Avatar, EditableText, Field, Section, Segmented } from './ui'
import { Attachments } from './Attachments'
import { AddInline } from './NodePanel'

const TABS: { value: ContextTab; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: 'goals', label: 'Goals' },
  { value: 'context', label: 'Context' },
  { value: 'signals', label: 'Changes' },
  { value: 'team', label: 'Team' },
  { value: 'refs', label: 'Refs' },
]

export function ContextPanel() {
  const tab = useStore((s) => s.contextTab)
  const setSide = useStore((s) => s.setSide)
  return (
    <div className="panel-inner">
      <header className="panel-head">
        <div className="ph-row">
          <h3>
            <Compass size={15} /> Context
          </h3>
          <span className="grow" />
          <button className="icon-btn" onClick={() => setSide(null)}>
            <X size={16} />
          </button>
        </div>
        <Segmented layoutId="ctx-tabs" size="sm" value={tab} onChange={(t) => useStore.setState({ contextTab: t })} options={TABS} />
      </header>
      <div className="panel-body">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {tab === 'now' && <NowTab />}
            {tab === 'goals' && <GoalsTab />}
            {tab === 'context' && <ContextTabView />}
            {tab === 'signals' && <SignalsTab />}
            {tab === 'team' && <TeamTab />}
            {tab === 'refs' && <RefsTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function NowTab() {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const steps = doc.nodes.filter((n) => doc.paths.find((p) => p.id === n.pathId)?.status !== 'archived')
  return (
    <>
      <Section title="Where you are right now" icon={MapPin}>
        <EditableText value={doc.current.title} onCommit={(title) => dispatch([{ t: 'pathway.update', patch: { current: { ...doc.current, title } } }])} className="title-lg" placeholder="e.g. Solo founder with an idea and $5k" />
        <EditableText
          value={doc.current.description}
          onCommit={(description) => dispatch([{ t: 'pathway.update', patch: { current: { ...doc.current, description } } }])}
          multiline
          className="desc"
          placeholder="What you have, what's working, what's not…"
        />
      </Section>
      <Section title="Where you are on each path" icon={MapPin}>
        <p className="hint">Pursue as many paths as you’re really working. Each keeps its own “you are here”; the fog clears around all of them.</p>
        <div className="positions">
          {doc.paths
            .filter((p) => p.status !== 'archived')
            .map((p) => (
              <div key={p.id} className={`pos-row ${p.pursuing ? 'on' : ''}`} style={{ '--c': p.color } as React.CSSProperties}>
                <button className={`pos-toggle ${p.pursuing ? 'on' : ''}`} title={p.pursuing ? 'Stop pursuing' : 'Pursue this path'} onClick={() => dispatch([{ t: 'path.pursue', id: p.id, on: !p.pursuing }])}>
                  {p.pursuing ? <Pause size={11} /> : <Play size={11} />}
                </button>
                <div className="grow">
                  <div className="pos-name">
                    <span className="dot" style={{ background: p.color }} /> {p.name}
                    <span className="faint sm">→ {doc.goals.find((g) => g.id === p.goalId)?.title}</span>
                  </div>
                  <select
                    className="select sm"
                    value={p.currentNodeId ?? ''}
                    onChange={(e) => dispatch([{ t: 'current.set', nodeId: e.target.value || null, pathId: p.id }])}
                  >
                    <option value="">At the start</option>
                    {steps
                      .filter((n) => n.pathId === p.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.parentId ? '   › ' : ''}
                          {n.status === 'done' ? '✓ ' : ''}
                          {n.title}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            ))}
        </div>
        {doc.paths.some((p) => p.currentNodeId) && (
          <button className="btn ghost xs" onClick={() => dispatch([{ t: 'current.set', nodeId: null }])}>
            <RotateCcw size={11} /> Reset every path to the start
          </button>
        )}
      </Section>
      <Section title="Plan clock">
        <Field label="Plan started" hint="planned vs actual is measured from here">
          <input type="date" className="input" value={doc.startDate.slice(0, 10)} onChange={(e) => e.target.value && dispatch([{ t: 'pathway.update', patch: { startDate: e.target.value } }])} />
        </Field>
      </Section>
    </>
  )
}

function GoalsTab() {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const ranks = useMemo(() => rankByGoal(doc), [doc])
  return (
    <>
      {doc.goals.map((g) => {
        const paths = doc.paths.filter((p) => p.goalId === g.id && p.status !== 'archived')
        const r = ranks[g.id]
        return (
          <motion.div key={g.id} layout className="goal-card" style={{ '--g': g.color } as React.CSSProperties}>
            <div className="row">
              <Target size={14} className="g-icon" />
              <EditableText value={g.title} onCommit={(title) => title.trim() && dispatch([{ t: 'goal.update', id: g.id, patch: { title } }])} className="title-md grow" />
              {doc.goals.length > 1 && (
                <button className="icon-btn sm" title="Remove goal" onClick={() => dispatch([{ t: 'goal.delete', id: g.id }])}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <EditableText value={g.description} onCommit={(description) => dispatch([{ t: 'goal.update', id: g.id, patch: { description } }])} multiline className="desc sm" placeholder="Why this matters / what success looks like" />
            <div className="row">
              <label className="mini-field">
                Deadline
                <input type="date" className="input sm" value={g.deadline?.slice(0, 10) ?? ''} onChange={(e) => dispatch([{ t: 'goal.update', id: g.id, patch: { deadline: e.target.value || undefined } }])} />
              </label>
              <div className="swatches sm">
                {GOAL_COLORS.map((c) => (
                  <button key={c} className={`swatch ${c === g.color ? 'on' : ''}`} style={{ background: c }} onClick={() => dispatch([{ t: 'goal.update', id: g.id, patch: { color: c } }])} />
                ))}
              </div>
            </div>
            <div className="goal-paths">
              {paths.map((p) => {
                const m = pathMetrics(doc, p.id)
                return (
                  <div key={p.id} className="gp">
                    <span className="dot" style={{ background: p.color }} />
                    <span className="grow">{p.name}</span>
                    {r?.quickest === p.id && <Zap size={11} className="quick" fill="currentColor" />}
                    <span className="faint">
                      {fmtDays(m.remainingDays)} · {fmtPct(m.probability)} · ends {fmtDate(m.forecastEnd)}
                    </span>
                  </div>
                )
              })}
              {!paths.length && <div className="faint sm">No paths lead here yet.</div>}
            </div>
          </motion.div>
        )
      })}
      <AddInline placeholder="Add another goal…" onAdd={(title) => dispatch([{ t: 'goal.add', goal: { id: uid(), title } }])} />
    </>
  )
}

const PROMPTS = ['Budget', 'Time per week', 'Skills', 'Team', 'Customers / audience', 'Constraints', 'Unfair advantages', 'Already tried', 'Risk appetite']

function ContextTabView() {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const [key, setKey] = useState(0)
  const insert = (label: string) => {
    const text = doc.context.trim() ? `${doc.context.trimEnd()}\n${label}: ` : `${label}: `
    dispatch([{ t: 'pathway.update', patch: { context: text } }])
    setKey((k) => k + 1)
  }
  return (
    <Section title="What the AI should know">
      <p className="hint">The more context, the better the paths. Everything here is read by your AI through MCP.</p>
      <div className="prompt-chips">
        {PROMPTS.map((p) => (
          <button key={p} className="chip-btn" onClick={() => insert(p)}>
            + {p}
          </button>
        ))}
      </div>
      <EditableText key={key} value={doc.context} onCommit={(context) => dispatch([{ t: 'pathway.update', patch: { context } }])} multiline className="desc big" placeholder={'Budget: $5k\nTime per week: 15h\nSkills: design, no-code\nConstraints: keep my day job until MRR > $3k'} />
    </Section>
  )
}

function SignalsTab() {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const user = useStore((s) => myName(s))
  const add = (kind: 'change' | 'ask', text: string) =>
    dispatch([{ t: 'signal.add', signal: { id: uid(), kind, text, at: new Date().toISOString(), by: user } }])
  const list = [...doc.signals].reverse()
  return (
    <>
      <Section title="What changed?" icon={Activity}>
        <p className="hint">Log real-world changes — a lost client, new funding, a launch that flopped. Your AI uses these to re-plan.</p>
        <AddInline placeholder="e.g. Got accepted to an accelerator" onAdd={(t) => add('change', t)} />
      </Section>
      <Section title="Ask the AI" icon={MessageSquarePlus}>
        <p className="hint">Leave a request; your AI picks it up next time it reads this pathway.</p>
        <AddInline placeholder="e.g. Find a faster path that doesn't need funding" onAdd={(t) => add('ask', t)} />
      </Section>
      <ul className="signals">
        <AnimatePresence initial={false}>
          {list.map((s) => (
            <motion.li key={s.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`sig ${s.kind} ${s.resolved ? 'resolved' : ''}`}>
              <span className="sig-icon">{s.kind === 'ask' ? <Sparkles size={11} /> : <Activity size={11} />}</span>
              <div className="grow">
                <div>{s.text}</div>
                <div className="faint sm">
                  {s.by} · {timeAgo(s.at)}
                  {s.kind === 'ask' && (s.resolved ? ' · handled' : ' · waiting for AI')}
                </div>
              </div>
              {s.kind === 'ask' && !s.resolved && (
                <button className="icon-btn sm" title="Mark handled" onClick={() => dispatch([{ t: 'signal.update', id: s.id, patch: { resolved: true } }])}>
                  <Check size={12} />
                </button>
              )}
              <button className="icon-btn sm" title="Remove" onClick={() => dispatch([{ t: 'signal.delete', id: s.id }])}>
                <X size={12} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </>
  )
}

function TeamTab() {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const filter = useStore((s) => s.personFilter)
  const setFilter = useStore((s) => s.setPersonFilter)
  return (
    <Section title="People">
      <p className="hint">Assign steps to people from a step's panel. Click someone to highlight their steps.</p>
      <ul className="team">
        {doc.people.map((p) => {
          const mine = doc.nodes.filter((n) => n.assignees.includes(p.id))
          const done = mine.filter((n) => n.status === 'done').length
          return (
            <li key={p.id} className={filter === p.id ? 'on' : ''}>
              <button onClick={() => setFilter(p.id)} title="Highlight their steps">
                <Avatar person={p} size={30} ring={filter === p.id} />
              </button>
              <div className="grow">
                <EditableText value={p.name} onCommit={(name) => name.trim() && dispatch([{ t: 'person.update', id: p.id, patch: { name } }])} className="title-sm" />
                <EditableText value={p.role ?? ''} onCommit={(role) => dispatch([{ t: 'person.update', id: p.id, patch: { role } }])} placeholder="role" className="faint-input" />
              </div>
              <span className="faint sm">
                {done}/{mine.length} steps
              </span>
              <div className="swatches xs">
                {PERSON_COLORS.slice(0, 4).map((c) => (
                  <button key={c} className={`swatch ${c === p.color ? 'on' : ''}`} style={{ background: c }} onClick={() => dispatch([{ t: 'person.update', id: p.id, patch: { color: c } }])} />
                ))}
              </div>
              <button className="icon-btn sm" onClick={() => dispatch([{ t: 'person.delete', id: p.id }])} title="Remove">
                <Trash2 size={12} />
              </button>
            </li>
          )
        })}
      </ul>
      <AddInline placeholder="Add a person…" onAdd={(name) => dispatch([{ t: 'person.add', person: { id: uid(), name } }])} />
    </Section>
  )
}

function RefsTab() {
  const doc = useStore((s) => s.doc)!
  return (
    <Section title="Pathway references" icon={Plus}>
      <p className="hint">Research, inspiration, competitors, docs — anything that shapes the whole plan.</p>
      <Attachments target={null} items={doc.attachments} />
    </Section>
  )
}
