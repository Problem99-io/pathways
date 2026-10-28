import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Shuffle,
  Split,
  Dices,
  Check,
  CircleDot,
  CornerDownRight,
  GitBranch,
  Link as LinkIcon,
  ListChecks,
  MapPin,
  Paperclip,
  Plus,
  Repeat,
  Sparkles,
  Timer,
  Trash2,
  Users,
  X,
  Layers,
  CalendarRange,
} from 'lucide-react'
import { plannedWindow, nodeDuration, pathMetrics, topo } from '../../shared/metrics'
import { normalised, outcomeIndex } from '../../shared/branches'
import { uid } from '../../shared/ops'
import type { Cadence, NodeKind, NodeStatus, PathNode } from '../../shared/types'
import { useStore } from '../store'
import { complete, drillInto, forkFrom, removeStep, setCurrent, addStep, addFutures, addOutcome, removeFutures, settleFork, setOutcomeTarget } from '../lib/actions'
import { fmtDate, fmtDays, KIND_LABEL, STATUS_LABEL, timeAgo } from '../lib/format'
import { Avatar, EditableText, KIND_ICON, Section, Segmented, softSpring } from './ui'
import { Attachments } from './Attachments'

export function NodePanel() {
  const doc = useStore((s) => s.doc)
  const selectedId = useStore((s) => s.selectedId)
  const node = doc?.nodes.find((n) => n.id === selectedId)
  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          key="node-panel"
          className="panel right"
          initial={{ x: 440, opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 440, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        >
          <NodeDetail node={node} key={node.id} />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function NodeDetail({ node: n }: { node: PathNode }) {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const select = useStore((s) => s.select)
  const path = doc.paths.find((p) => p.id === n.pathId)
  const kids = doc.nodes.filter((x) => x.parentId === n.id)
  const siblings = doc.nodes.filter((x) => x.pathId === n.pathId && x.parentId === n.parentId && x.id !== n.id)
  const parent = n.parentId ? doc.nodes.find((x) => x.id === n.parentId) : null
  const win = useMemo(() => plannedWindow(doc, n), [doc, n])
  const effective = useMemo(() => nodeDuration(doc, n), [doc, n])
  const isCurrent = path?.currentNodeId === n.id
  const [confirmDel, setConfirmDel] = useState(false)
  const upd = (patch: Partial<PathNode>) => dispatch([{ t: 'node.update', id: n.id, patch }])
  const Icon = KIND_ICON[n.kind]

  return (
    <div className="panel-inner" style={{ '--c': path?.color } as React.CSSProperties}>
      <header className="panel-head">
        <div className="ph-row">
          <span className="ph-path">
            <span className="dot" style={{ background: path?.color }} />
            {path?.name}
            {parent && (
              <>
                <span className="faint">›</span>
                <button className="link" onClick={() => select(parent.id)}>
                  {parent.title}
                </button>
              </>
            )}
          </span>
          <span className="grow" />
          {n.createdBy === 'ai' && (
            <span className="tag-ai">
              <Sparkles size={10} /> AI
            </span>
          )}
          <button className="icon-btn" onClick={() => select(null)} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="ph-title">
          <span className="ph-icon">
            <Icon size={16} />
          </span>
          <EditableText value={n.title} onCommit={(title) => title.trim() && upd({ title })} className="title-xl" multiline />
        </div>
        <Segmented<NodeKind>
          layoutId="kind-seg"
          size="sm"
          value={n.kind}
          onChange={(kind) => upd({ kind })}
          options={(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => {
            const I = KIND_ICON[k]
            return { value: k, label: <><I size={12} /> {KIND_LABEL[k]}</>, title: KIND_LABEL[k] }
          })}
        />
        <Segmented<NodeStatus>
          layoutId="status-seg"
          value={n.status}
          onChange={(status) => upd({ status })}
          options={(Object.keys(STATUS_LABEL) as NodeStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />
        <div className="ph-actions">
          <button className={`btn sm ${isCurrent ? 'on' : ''}`} onClick={() => (isCurrent ? setCurrent(n.parentId, n.pathId) : setCurrent(n.id))} title="Mark this as where you are on this path (.)">
            <MapPin size={13} /> {isCurrent ? 'You are here' : 'I’m here'}
          </button>
          {n.status !== 'done' && (
            <button className="btn sm primary" onClick={() => complete(n)} title="Complete and move on (C)">
              <Check size={13} /> Complete
            </button>
          )}
          <button className="btn sm" onClick={() => drillInto(n)} title="Open the sub-path (Enter)">
            <CornerDownRight size={13} /> {kids.length ? 'Drill in' : 'Break down'}
          </button>
          <button className="btn sm" onClick={() => forkFrom(n)} title="Explore a what-if: copy the path up to here and branch off">
            <GitBranch size={13} /> What if…
          </button>
          {!n.branch?.outcomes.length && (
            <button className="btn sm" onClick={() => addFutures(n, 'chance')} title="After this step the future could go several ways: map them, with their odds">
              <Split size={13} /> Futures
            </button>
          )}
        </div>
      </header>

      <div className="panel-body">
        <OutcomeOf n={n} />
        <EditableText value={n.description} onCommit={(description) => upd({ description })} placeholder="What does done look like? How will you do it?" multiline className="desc" />
        {n.branch?.outcomes.length ? <FuturesBlock n={n} /> : null}

        <Section title="Estimate" icon={Timer}>
          <div className="est-grid">
            <label>
              <span>Duration</span>
              <div className="num">
                <NumInput value={n.durationDays} onCommit={(durationDays) => upd({ durationDays })} />
                <em>days</em>
              </div>
              {effective !== n.durationDays && <small>{fmtDays(effective)} incl. sub-steps</small>}
            </label>
            <label>
              <span>Cost</span>
              <div className="num">
                <em>$</em>
                <NumInput value={n.cost} onCommit={(cost) => upd({ cost })} />
              </div>
            </label>
            <label className="span2">
              <span>
                Confidence <b>{Math.round(n.confidence * 100)}%</b>
              </span>
              <input type="range" min={5} max={100} step={5} defaultValue={Math.round(n.confidence * 100)} key={n.confidence} onPointerUp={(e) => upd({ confidence: Number((e.target as HTMLInputElement).value) / 100 })} onKeyUp={(e) => upd({ confidence: Number((e.target as HTMLInputElement).value) / 100 })} className="range" />
            </label>
          </div>
        </Section>

        <Section title="Schedule" icon={CalendarRange}>
          <div className="sched">
            {(n.kind === 'milestone' || n.deadline) && (
              <div>
                <span>{n.kind === 'milestone' ? 'Target date' : 'Deadline'}</span>
                <input type="date" className="input sm date" value={n.deadline?.slice(0, 10) ?? ''} onChange={(e) => upd({ deadline: e.target.value || undefined })} />
              </div>
            )}
            <div>
              <span>Planned</span>
              <b>
                {win ? `${fmtDate(win.start)} → ${fmtDate(win.end)}` : '—'}
              </b>
            </div>
            <div>
              <span>Actual</span>
              <b>
                {n.startedAt ? fmtDate(n.startedAt) : 'not started'}
                {n.completedAt ? ` → ${fmtDate(n.completedAt)}` : n.startedAt ? ' → …' : ''}
              </b>
            </div>
            {win && n.completedAt && (
              <div>
                <span>Delta</span>
                <ScheduleDelta planned={win.end} actual={n.completedAt} />
              </div>
            )}
          </div>
        </Section>

        {n.kind === 'recurring' && <RecurringBlock n={n} />}

        <Section title="Requirements" icon={ListChecks}>
          <ul className="reqs">
            <AnimatePresence initial={false}>
              {n.requirements.map((r) => (
                <motion.li key={r.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} transition={softSpring} className={r.done ? 'done' : ''}>
                  <button className="check" onClick={() => upd({ requirements: n.requirements.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)) })}>
                    {r.done && <Check size={10} strokeWidth={3.5} />}
                  </button>
                  <EditableText value={r.text} onCommit={(text) => upd({ requirements: n.requirements.map((x) => (x.id === r.id ? { ...x, text } : x)) })} />
                  <button className="x" onClick={() => upd({ requirements: n.requirements.filter((x) => x.id !== r.id) })}>
                    <X size={11} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <AddInline placeholder="Add a requirement…" onAdd={(text) => upd({ requirements: [...n.requirements, { id: uid(), text, done: false }] })} />
        </Section>

        <Section
          title={n.kind === 'recurring' ? 'Each cycle' : 'Sub-steps'}
          icon={Layers}
          action={
            kids.length > 0 && (
              <button className="btn ghost xs" onClick={() => drillInto(n)}>
                Open <CornerDownRight size={11} />
              </button>
            )
          }
        >
          <ul className="kids">
            {kids.map((k) => (
              <li key={k.id} onClick={() => select(k.id)}>
                <span className={`status-dot sm s-${k.status}`}>{k.status === 'done' && <Check size={7} strokeWidth={4} />}</span>
                <span className="grow">{k.title}</span>
                <span className="faint">{fmtDays(k.durationDays)}</span>
              </li>
            ))}
          </ul>
          <AddInline
            placeholder={n.kind === 'recurring' ? 'Add a step to every cycle…' : 'Add a sub-step…'}
            onAdd={(title) => {
              const last = kids.filter((k) => !kids.some((o) => o.dependsOn.includes(k.id))).at(-1)
              addStep({ pathId: n.pathId, parentId: n.id, title, after: last?.id, select: false })
            }}
          />
        </Section>

        <Section title="People" icon={Users}>
          <div className="people-pick">
            {doc.people.map((p) => {
              const on = n.assignees.includes(p.id)
              return (
                <button key={p.id} className={`person ${on ? 'on' : ''}`} onClick={() => dispatch([{ t: 'assign', nodeId: n.id, personId: p.id, on: !on }])}>
                  <Avatar person={p} size={20} />
                  {p.name}
                </button>
              )
            })}
            <AddInline
              placeholder={doc.people.length ? 'Add someone…' : 'Add a teammate by name…'}
              compact
              onAdd={(name) => {
                const id = uid()
                dispatch([
                  { t: 'person.add', person: { id, name } },
                  { t: 'assign', nodeId: n.id, personId: id, on: true },
                ])
              }}
            />
          </div>
        </Section>

        <Section title="Depends on" icon={LinkIcon}>
          <div className="deps">
            {n.dependsOn.map((d) => {
              const dn = doc.nodes.find((x) => x.id === d)
              return (
                <span key={d} className="dep">
                  <CircleDot size={10} />
                  <button className="link" onClick={() => select(d)}>
                    {dn?.title ?? d}
                  </button>
                  <button className="x" onClick={() => dispatch([{ t: 'edge.delete', source: d, target: n.id }])}>
                    <X size={10} />
                  </button>
                </span>
              )
            })}
            {!n.dependsOn.length && <span className="faint sm">Starts right away</span>}
            {siblings.length > 0 && (
              <select
                className="dep-add"
                value=""
                onChange={(e) => e.target.value && dispatch([{ t: 'edge.add', source: e.target.value, target: n.id }])}
              >
                <option value="">+ add dependency</option>
                {siblings
                  .filter((s) => !n.dependsOn.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </Section>

        <Section title="References" icon={Paperclip}>
          <Attachments target={n.id} items={n.attachments} />
        </Section>

        <footer className="panel-foot">
          <span>
            {n.createdBy === 'ai' ? 'Suggested by AI' : 'Added'} {timeAgo(n.createdAt)} · edited {timeAgo(n.updatedAt)}
          </span>
          <button className={`btn ghost xs danger ${confirmDel ? 'armed' : ''}`} onClick={() => (confirmDel ? removeStep(n.id) : setConfirmDel(true))} onMouseLeave={() => setConfirmDel(false)}>
            <Trash2 size={12} /> {confirmDel ? 'Click to delete' : 'Delete'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** When this step only happens in one of a fork's futures. */
function OutcomeOf({ n }: { n: PathNode }) {
  const doc = useStore((s) => s.doc)!
  const select = useStore((s) => s.select)
  // other paths that may switch onto this path here
  const arrivals = doc.nodes.flatMap((f) => (f.branch?.outcomes ?? []).filter((o) => o.jumpTo?.nodeId === n.id).map((o) => ({ f, o })))
  if (arrivals.length && !n.outcomeOf) {
    return (
      <>
        {arrivals.map(({ f, o }) => {
          const from = doc.paths.find((p) => p.id === f.pathId)
          const pct = f.branch!.mode === 'chance' ? Math.round(normalised(f.branch!).find((x) => x.id === o.id)!.probability * 100) : null
          const b = f.branch!
          return (
            <div key={o.id} className={`outcome-of ${b.resolved ? (b.resolved === o.id ? 'taken' : 'gone') : ''}`}>
              <Shuffle size={13} />
              <span className="grow">
                {b.resolved === o.id ? 'You switched here from' : 'You may switch here from'} <b>{from?.name}</b> if <b>{o.label}</b>
                {pct !== null && !b.resolved && <> · {pct}%</>} after{' '}
                <button className="link" onClick={() => select(f.id)}>
                  {f.title}
                </button>
              </span>
            </div>
          )
        })}
      </>
    )
  }
  if (!n.outcomeOf) return null
  const fork = outcomeIndex(doc).get(n.outcomeOf)
  if (!fork?.branch) return null
  const o = normalised(fork.branch).find((x) => x.id === n.outcomeOf)!
  const b = fork.branch
  return (
    <div className={`outcome-of ${b.resolved ? (b.resolved === o.id ? 'taken' : 'gone') : ''}`}>
      <Split size={13} />
      <span className="grow">
        {b.resolved === o.id ? 'This is the way it went' : b.resolved ? 'Didn’t happen' : 'Only happens'} if <b>{o.label}</b>
        {b.mode === 'chance' && !b.resolved && <> · {Math.round(o.probability * 100)}%</>}
        {' '}after{' '}
        <button className="link" onClick={() => select(fork.id)}>
          {fork.title}
        </button>
      </span>
    </div>
  )
}

/** A fork: the ways the future could go from here, their odds, and what each means for the goal. */
function FuturesBlock({ n }: { n: PathNode }) {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const goTo = useStore((s) => s.goTo)
  const b = n.branch!
  const f = useMemo(() => pathMetrics(doc, n.pathId).futures, [doc, n.pathId])
  const norm = normalised(b)
  const setBranch = (patch: Partial<typeof b>) => dispatch([{ t: 'node.update', id: n.id, patch: { branch: { ...b, ...patch } } }])
  const setOutcome = (id: string, patch: Partial<(typeof b.outcomes)[number]>) => setBranch({ outcomes: b.outcomes.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
  const firstStep = (oid: string) => doc.nodes.find((x) => x.outcomeOf === oid)
  const mine = f?.scenarios.filter((s) => s.outcomes.some((o) => o.branchId === n.id)) ?? []
  const [confirm, setConfirm] = useState(false)
  return (
    <Section title={b.mode === 'chance' ? 'Possible futures' : 'Options'} icon={Split}>
      <Segmented<'chance' | 'choice'>
        layoutId="fork-mode"
        size="sm"
        value={b.mode}
        onChange={(mode) => setBranch({ mode })}
        options={[
          { value: 'chance', label: <><Dices size={12} /> It could go…</>, title: 'Not up to you: each outcome has odds' },
          { value: 'choice', label: <><Split size={12} /> I’ll choose</>, title: 'You pick which way to go' },
        ]}
      />
      <ul className="futures">
        {b.outcomes.map((o) => {
          const days = f?.byOutcome[o.id]?.days
          const first = firstStep(o.id)
          const taken = b.resolved === o.id
          return (
            <li key={o.id} className={`future ${taken ? 'taken' : b.resolved ? 'gone' : ''}`}>
              <div className="row">
                <EditableText value={o.label} onCommit={(label) => label.trim() && setOutcome(o.id, { label: label.trim() })} className="future-label" />
                {days !== undefined && !b.resolved && <span className="future-days" title="Expected days to the goal if this happens">~{fmtDays(days)}</span>}
                <button
                  className={`icon-btn sm settle ${taken ? 'on' : ''}`}
                  title={taken ? 'Not settled yet' : b.mode === 'chance' ? 'This is what happened' : 'Go this way'}
                  onClick={() => settleFork(n, taken ? null : o.id)}
                >
                  <Check size={12} />
                </button>
              </div>
              {b.mode === 'chance' && !b.resolved && (
                <OddsSlider
                  value={o.probability}
                  others={b.outcomes.filter((x) => x.id !== o.id).reduce((a, x) => a + Math.max(0, x.probability || 0), 0)}
                  onCommit={(v) => setOutcome(o.id, { probability: v })}
                />
              )}
              <div className="future-foot">
                <select
                  className="leads-to"
                  value={o.jumpTo ? o.jumpTo.nodeId : ''}
                  title="Where this future goes: steps of its own, or switch to another path and start at one of its steps"
                  onChange={(e) => setOutcomeTarget(n, o.id, e.target.value ? doc.nodes.find((x) => x.id === e.target.value) ?? null : null)}
                >
                  <option value="">Its own steps</option>
                  {doc.paths
                    .filter((p) => p.id !== n.pathId && p.status !== 'archived')
                    .map((p) => (
                      <optgroup key={p.id} label={`Switch to ${p.name} at…`}>
                        {topo(doc.nodes.filter((x) => x.pathId === p.id && x.parentId === null)).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.title}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
                {o.jumpTo ? (
                  <button className="link" onClick={() => goTo({ nodeId: o.jumpTo!.nodeId })}>
                    <Shuffle size={11} /> {doc.paths.find((p) => p.id === o.jumpTo!.pathId)?.name}
                  </button>
                ) : first ? (
                  <button className="link" onClick={() => goTo({ nodeId: first.id })}>
                    <CornerDownRight size={11} /> {first.title}
                  </button>
                ) : (
                  <button className="link" onClick={() => setOutcomeTarget(n, o.id, null)}>
                    <Plus size={11} /> First step this way
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {f && mine.length > 1 && !b.resolved && (
        <div className="futures-sum">
          <div className="row">
            <span>
              Expected <b>~{fmtDays(f.expectedDays)}</b> to the goal
            </span>
            <span className="grow" />
            <span className="faint">
              {fmtDays(f.bestDays)} best · {fmtDays(f.worstDays)} worst
            </span>
          </div>
          {mine.slice(0, 4).map((sc, i) => (
            <div key={i} className="scenario">
              <span className="sc-bar">
                <i style={{ width: `${sc.probability * 100}%` }} />
              </span>
              <span className="sc-pct">{Math.round(sc.probability * 100)}%</span>
              <span className="sc-label">{sc.outcomes.map((x) => x.label).join(' → ')}</span>
              <span className="sc-days">{fmtDays(sc.days)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="row futures-acts">
        <button className="btn sm" onClick={() => addOutcome(n)}>
          <Plus size={12} /> Add outcome
        </button>
        <span className="grow" />
        <button className={`btn sm ghost ${confirm ? 'danger' : ''}`} onClick={() => (confirm ? removeFutures(n) : setConfirm(true))} onBlur={() => setConfirm(false)}>
          {confirm ? 'Remove? Steps stay' : 'Remove fork'}
        </button>
      </div>
    </Section>
  )
}

function OddsSlider({ value, others, onCommit }: { value: number; others: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value)
  const [drag, setDrag] = useState(false)
  const shown = drag ? v : value
  const commit = () => {
    setDrag(false)
    if (Math.abs(v - value) > 0.001) onCommit(v)
  }
  return (
    <label className="odds-slider" title="How likely this is (the outcomes are balanced to add up to 100%)">
      <input
        type="range"
        min={0.01}
        max={1}
        step={0.01}
        value={shown}
        onChange={(e) => {
          setDrag(true)
          setV(Number(e.target.value))
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => drag && commit()}
      />
      <span>{Math.round((shown / Math.max(shown + others, 0.0001)) * 100)}%</span>
    </label>
  )
}

function RecurringBlock({ n }: { n: PathNode }) {
  const dispatch = useStore((s) => s.dispatch)
  const rec = n.recurrence ?? { cadence: 'weekly' as Cadence, cycles: [] }
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const upd = (patch: Partial<typeof rec>) => dispatch([{ t: 'node.update', id: n.id, patch: { recurrence: { ...rec, ...patch } } }])
  const last = rec.cycles.at(-1)
  const values = rec.cycles.map((c) => parseFloat(String(c.value ?? '').replace(/[^\d.]/g, ''))).filter((v) => !isNaN(v))
  return (
    <Section title="Loop" icon={Repeat}>
      <div className="loop-block">
        <Segmented<Cadence>
          layoutId="cadence-seg"
          size="sm"
          value={rec.cadence}
          onChange={(cadence) => upd({ cadence })}
          options={(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'] as Cadence[]).map((c) => ({ value: c, label: c }))}
        />
        <div className="loop-metric">
          <EditableText value={rec.metric ?? ''} onCommit={(metric) => upd({ metric })} placeholder="metric (e.g. followers)" />
          <EditableText value={rec.current ?? ''} onCommit={(current) => upd({ current })} placeholder="now" className="short" />
          <span className="faint">→</span>
          <EditableText value={rec.target ?? ''} onCommit={(target) => upd({ target })} placeholder="target" className="short" />
        </div>
        {values.length > 1 && <Sparkline values={values} />}
        <div className="log-cycle">
          <input placeholder="value now" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="short" />
          <input placeholder="what happened this cycle?" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <button
            className="btn sm primary"
            onClick={() => {
              dispatch([{ t: 'cycle.log', id: n.id, cycle: { id: uid(), at: new Date().toISOString(), value: value || undefined, note: note || undefined } }])
              setValue('')
              setNote('')
            }}
          >
            <Repeat size={12} /> Log cycle
          </button>
        </div>
        <div className="faint sm">
          {rec.cycles.length} cycle{rec.cycles.length === 1 ? '' : 's'} logged{last ? ` · last ${timeAgo(last.at)}` : ''}
        </div>
        {rec.cycles.length > 0 && (
          <ul className="cycles">
            {rec.cycles
              .slice(-5)
              .reverse()
              .map((c) => (
                <li key={c.id}>
                  <span className="faint">{fmtDate(c.at)}</span>
                  {c.value && <b>{c.value}</b>}
                  <span>{c.note}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const w = 300
  const h = 36
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - min) / (max - min || 1)) * (h - 8)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--c)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ScheduleDelta({ planned, actual }: { planned: string; actual: string }) {
  const d = Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 86_400_000)
  return <b className={d > 0 ? 'late' : 'ok'}>{d === 0 ? 'on time' : d > 0 ? `${d}d late` : `${-d}d early`}</b>
}

function NumInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setV(String(value))
  }
  return (
    <input
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLElement).blur()
      }}
      onBlur={() => {
        const n = Math.max(0, parseFloat(v) || 0)
        if (n !== value) onCommit(n)
        else setV(String(value))
      }}
    />
  )
}

export function AddInline({ placeholder, onAdd, compact }: { placeholder: string; onAdd: (v: string) => void; compact?: boolean }) {
  const [v, setV] = useState('')
  return (
    <div className={`add-inline ${compact ? 'compact' : ''}`}>
      <Plus size={12} />
      <input
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && v.trim()) {
            onAdd(v.trim())
            setV('')
          }
        }}
      />
    </div>
  )
}
