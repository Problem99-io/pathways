// What each right-click menu holds. Built from the live pathway every render.

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Focus,
  GitBranch,
  GitFork,
  Hand,
  Highlighter,
  Layers,
  MapPin,
  Maximize,
  Mouse,
  PanelRight,
  PenLine,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Target,
  Telescope,
  Trash2,
  User,
  UserPlus,
  Users,
  Palette,
  Activity,
  MessageSquare,
  Split,
  Dices,
} from 'lucide-react'
import { rankByGoal } from '../../shared/metrics'
import { uid, type Op } from '../../shared/ops'
import { PATH_COLORS, type NodeKind, type NodeStatus, type PathNode, type Pathway } from '../../shared/types'
import { mePerson, myName, useStore } from '../store'
import { addFutures, addNext, addOutcome, addParallel, addStep, complete, drillInto, forkFrom, newPath, pursue, removeFutures, removeStep, setCurrent, settleFork } from '../lib/actions'
import { normalised } from '../../shared/branches'
import { pathMetrics } from '../../shared/metrics'
import { fmtDate, KIND_LABEL, STATUS_LABEL } from '../lib/format'
import type { FlowEdgeData } from '../lib/layout'
import type { MenuEntry, MenuItem, MenuSpec } from './ContextMenu'
import { KIND_ICON } from './ui'
import { askClaude, chatReady, useChat } from '../chat'

export type MenuTarget =
  | { kind: 'step'; id: string }
  | { kind: 'path'; id: string }
  | { kind: 'goal'; id: string }
  | { kind: 'start' }
  | { kind: 'edge'; source: string; target: string; insert?: FlowEdgeData['insert'] }
  | { kind: 'pane' }
  | { kind: 'settle'; id: string }

const st = () => useStore.getState()
const dispatch = (ops: Op[]) => st().dispatch(ops)
const finished = (n: PathNode) => n.status === 'done' || n.status === 'skipped'
const STATUS_ICON: Record<NodeStatus, typeof Check> = { todo: Flag, in_progress: Play, done: Check, blocked: Pause, skipped: ArrowRight }

/** Leave a request for the AI; it picks these up the next time it reads the pathway. */
const ask = (text: string) => {
  // straight to the in-app chat when Claude is set up; otherwise a request any connected AI picks up
  if (chatReady(useChat.getState().status)) return askClaude(text)
  dispatch([{ t: 'signal.add', signal: { id: uid(), kind: 'ask', text, at: new Date().toISOString(), by: myName() } }])
  st().toast({ text: 'Request left for your AI', tone: 'ai', who: 'AI' })
}

/** Ask the canvas to frame everything. */
export const FIT_EVENT = 'pathways:fit'

export function buildMenu(t: MenuTarget): MenuSpec | null {
  const s = st()
  const doc = s.doc
  if (!doc) return null
  switch (t.kind) {
    case 'step':
      return stepMenu(doc, t.id)
    case 'path':
      return pathMenu(doc, t.id)
    case 'goal':
      return goalMenu(doc, t.id)
    case 'start':
      return startMenu(doc)
    case 'edge':
      return edgeMenu(doc, t)
    case 'pane':
      return paneMenu(doc)
    case 'settle':
      return settleMenu(doc, t.id)
  }
}

function stepMenu(doc: Pathway, id: string): MenuSpec | null {
  const s = st()
  const n = doc.nodes.find((x) => x.id === id)
  if (!n) return null
  const path = doc.paths.find((p) => p.id === n.pathId)
  const kids = doc.nodes.filter((x) => x.parentId === n.id)
  const me = mePerson(doc, s.me)
  const here = path?.currentNodeId === n.id
  const hl = s.highlightPathId === n.pathId

  const entries: MenuEntry[] = [
    { id: 'open', label: 'Open details', icon: PanelRight, run: () => s.select(n.id) },
    !here && { id: 'here', label: 'I’m here', icon: MapPin, kbd: '.', run: () => setCurrent(n.id) },
    finished(n)
      ? { id: 'reopen', label: 'Reopen', icon: RotateCcw, run: () => dispatch([{ t: 'node.update', id: n.id, patch: { status: 'todo' } }]) }
      : { id: 'done', label: n.kind === 'milestone' ? 'Mark milestone reached' : 'Complete', icon: Check, kbd: 'C', run: () => complete(n) },
    {
      id: 'status',
      label: 'Status',
      icon: Activity,
      items: (Object.keys(STATUS_LABEL) as NodeStatus[]).map((k) => ({
        id: k,
        label: STATUS_LABEL[k],
        icon: STATUS_ICON[k],
        checked: n.status === k,
        run: () => (k === 'done' ? complete(n) : dispatch([{ t: 'node.update', id: n.id, patch: { status: k } }])),
      })),
    },
    {
      id: 'kind',
      label: 'Kind',
      icon: Tag,
      items: (Object.keys(KIND_LABEL) as NodeKind[]).map((k) => ({
        id: k,
        label: KIND_LABEL[k],
        icon: k === 'milestone' ? Flag : KIND_ICON[k],
        checked: n.kind === k,
        run: () => dispatch([{ t: 'node.update', id: n.id, patch: { kind: k } }]),
      })),
    },
    me && !n.assignees.includes(me.id) && { id: 'mine', label: 'Assign to me', icon: User, run: () => dispatch([{ t: 'assign', nodeId: n.id, personId: me.id, on: true }]) },
    {
      id: 'people',
      label: 'Assign',
      icon: Users,
      items: [
        ...doc.people.map(
          (p): MenuItem => ({
            id: p.id,
            label: p.id === me?.id ? `${p.name} (you)` : p.name,
            color: p.color,
            checked: n.assignees.includes(p.id),
            keepOpen: true,
            run: () => dispatch([{ t: 'assign', nodeId: n.id, personId: p.id, on: !n.assignees.includes(p.id) }]),
          }),
        ),
        ...(doc.people.length ? (['-'] as MenuEntry[]) : []),
        { id: 'team', label: 'Manage team…', icon: UserPlus, run: () => s.setSide('context', 'team') },
      ],
    },
    '-',
    { id: 'next', label: 'Add next step', icon: ArrowRight, kbd: 'Tab', run: () => addNext(n) },
    { id: 'par', label: 'Add parallel step', icon: GitFork, run: () => addParallel(n) },
    {
      id: 'drill',
      label: n.kind === 'recurring' ? 'Open the loop' : kids.length ? `Open sub-steps · ${kids.length}` : 'Break down into sub-steps',
      icon: Layers,
      kbd: '↵',
      run: () => drillInto(n),
    },
    n.branch?.outcomes.length
      ? {
          id: 'settle',
          label: n.branch.mode === 'chance' ? 'What happened?' : 'Which way?',
          icon: Split,
          items: settleEntries(doc, n),
        }
      : {
          id: 'futures',
          label: 'Possible futures',
          icon: Split,
          items: [
            { id: 'chance', label: 'It could go several ways', icon: Dices, run: () => addFutures(n, 'chance') },
            { id: 'choice', label: 'I’ll choose between options', icon: Split, run: () => addFutures(n, 'choice') },
            '-',
            {
              id: 'ai-futures',
              label: 'Ask AI to map the futures',
              icon: Sparkles,
              run: () => ask(`Map the possible futures after “${n.title}” on ${path?.name ?? 'this path'}: what could realistically happen, how likely each is, and the steps each way leads to. Use branch_step.`),
            },
          ],
        },
    { id: 'fork', label: 'What if… fork from here', icon: GitBranch, run: () => forkFrom(n) },
    '-',
    { id: 'hl', label: hl ? 'Clear highlight' : 'Highlight this path', icon: Highlighter, run: () => s.setHighlight(hl ? null : n.pathId) },
    {
      id: 'ai',
      label: 'Ask AI',
      icon: Sparkles,
      items: [
        { id: 'ai-break', label: 'Break it down', icon: Layers, run: () => ask(`Break down “${n.title}” into concrete sub-steps with estimates.`) },
        { id: 'ai-alt', label: 'Find another way past it', icon: GitBranch, run: () => ask(`Suggest other ways to get past “${n.title}” on ${path?.name ?? 'this path'} — fork the path if one is quicker.`) },
        { id: 'ai-research', label: 'Research what it takes', icon: Search, run: () => ask(`Research what “${n.title}” really takes and add references and requirements to it.`) },
      ],
    },
    {
      id: 'chat',
      label: 'Ask Claude about this…',
      icon: MessageSquare,
      run: () => {
        s.select(n.id)
        askClaude('')
      },
    },
    { id: 'copy', label: 'Copy title', icon: Copy, run: () => void navigator.clipboard?.writeText(n.title) },
    '-',
    {
      id: 'del',
      label: kids.length ? `Delete with ${kids.length} sub-step${kids.length === 1 ? '' : 's'}` : 'Delete step',
      icon: Trash2,
      danger: true,
      confirm: 'Click again to delete',
      run: () => removeStep(n.id),
    },
  ].filter(Boolean) as MenuEntry[]

  return {
    title: n.title,
    sub: `${KIND_LABEL[n.kind]} · ${STATUS_LABEL[n.status]}${path ? ` · ${path.name}` : ''}`,
    color: path?.color,
    rename: (title) => dispatch([{ t: 'node.update', id: n.id, patch: { title } }]),
    entries: [{ id: '__rename', label: 'Rename', icon: PenLine }, ...entries],
  }
}

/** The outcomes of a fork, to say which way it went (or which option you're taking). */
function settleEntries(doc: Pathway, n: PathNode): MenuEntry[] {
  const b = n.branch!
  const f = pathMetrics(doc, n.pathId).futures
  const out: MenuEntry[] = normalised(b).map((o) => {
    const days = f?.byOutcome[o.id]?.days
    return {
      id: o.id,
      label: `${b.mode === 'chance' ? `${Math.round(o.probability * 100)}% · ` : ''}${o.label}${!b.resolved && days !== undefined ? ` · ~${Math.round(days)}d` : ''}`,
      checked: b.resolved === o.id,
      icon: b.mode === 'chance' ? Dices : Split,
      run: () => settleFork(n, o.id),
    }
  })
  out.push('-')
  if (b.resolved) out.push({ id: 'unsettle', label: 'Not settled yet', icon: RotateCcw, run: () => settleFork(n, null) })
  out.push({ id: 'more', label: 'Add another outcome', icon: Plus, run: () => addOutcome(n) })
  out.push({ id: 'edit', label: 'Edit odds & outcomes', icon: PenLine, run: () => st().select(n.id) })
  out.push({ id: 'unfork', label: 'Remove the fork', icon: Trash2, danger: true, confirm: 'Click again — steps stay', run: () => removeFutures(n) })
  return out
}

function settleMenu(doc: Pathway, id: string): MenuSpec | null {
  const n = doc.nodes.find((x) => x.id === id)
  if (!n?.branch) return null
  const path = doc.paths.find((p) => p.id === n.pathId)
  return {
    title: n.title,
    sub: n.branch.mode === 'chance' ? 'What happened?' : 'Which way are you going?',
    color: path?.color,
    entries: settleEntries(doc, n),
  }
}

function pathMenu(doc: Pathway, id: string): MenuSpec | null {
  const s = st()
  const path = doc.paths.find((p) => p.id === id)
  if (!path) return null
  const goal = doc.goals.find((g) => g.id === path.goalId)
  const hl = s.highlightPathId === path.id
  const iso = s.focusPathId === path.id
  const patch = (p: Partial<typeof path>) => dispatch([{ t: 'path.update', id: path.id, patch: p }])
  const addAtEnd = () => {
    // after the step nothing else on this level depends on
    const level = doc.nodes.filter((n) => n.pathId === path.id && n.parentId === (s.scope ?? null))
    const last = level.filter((n) => !level.some((m) => m.dependsOn.includes(n.id))).at(-1)
    addStep({ pathId: path.id, parentId: s.scope ?? null, after: last?.id })
  }
  const entries: MenuEntry[] = [
    { id: '__rename', label: 'Rename', icon: PenLine },
    path.pursuing
      ? { id: 'pause', label: 'Stop pursuing', icon: Pause, run: () => pursue(path.id, false) }
      : { id: 'pursue', label: 'Pursue this path', icon: Play, run: () => pursue(path.id, true) },
    path.currentNodeId ? { id: 'reset', label: 'Move “here” back to its start', icon: RotateCcw, run: () => setCurrent(null, path.id) } : null,
    { id: 'hl', label: hl ? 'Clear highlight' : 'Highlight', icon: Highlighter, run: () => s.setHighlight(hl ? null : path.id) },
    { id: 'iso', label: iso ? 'Show all paths' : 'Show only this path', icon: Focus, run: () => s.setFocusPath(iso ? null : path.id) },
    { id: 'add', label: 'Add a step at the end', icon: Plus, run: addAtEnd },
    '-',
    doc.goals.length > 1
      ? {
          id: 'goal',
          label: 'Leads to',
          icon: Target,
          items: doc.goals.map((g) => ({ id: g.id, label: g.title, color: g.color, checked: g.id === path.goalId, run: () => patch({ goalId: g.id }) })),
        }
      : null,
    {
      id: 'color',
      label: 'Colour',
      icon: Palette,
      items: PATH_COLORS.map((c, i) => ({ id: c, label: `Colour ${i + 1}`, color: c, checked: c === path.color, keepOpen: true, run: () => patch({ color: c }) })),
    },
    path.status === 'proposed'
      ? { id: 'accept', label: 'Accept proposal', icon: Check, run: () => patch({ status: 'active' }) }
      : { id: 'propose', label: 'Mark as proposal', icon: GitBranch, run: () => patch({ status: 'proposed' }) },
    { id: 'dup', label: 'Duplicate', icon: Copy, run: () => dispatch([{ t: 'path.fork', id: path.id, newId: uid(), name: `${path.name} (copy)` }]) },
    {
      id: 'ai',
      label: 'Ask AI',
      icon: Sparkles,
      items: [
        { id: 'ai-fast', label: 'Find a faster alternative', icon: GitFork, run: () => ask(`Find a faster alternative to the path “${path.name}” toward ${goal?.title ?? 'its goal'}.`) },
        { id: 'ai-est', label: 'Re-check its estimates', icon: Activity, run: () => ask(`Re-check the durations and confidence on “${path.name}” against what's happened so far.`) },
        { id: 'ai-risk', label: 'Stress-test its risks', icon: Flag, run: () => ask(`Stress-test “${path.name}”: what could break it, and what step would de-risk it earliest?`) },
      ],
    },
    '-',
    { id: 'archive', label: 'Archive', icon: Archive, run: () => patch({ status: 'archived' }) },
    { id: 'del', label: 'Delete path', icon: Trash2, danger: true, confirm: 'Click again to delete', run: () => dispatch([{ t: 'path.delete', id: path.id }]) },
  ].filter(Boolean) as MenuEntry[]
  return {
    title: path.name,
    sub: `→ ${goal?.title ?? 'goal'}${path.pursuing ? ' · pursuing' : ''}${path.status === 'proposed' ? ' · proposal' : ''}`,
    color: path.color,
    rename: (name) => patch({ name }),
    entries,
  }
}

function goalMenu(doc: Pathway, id: string): MenuSpec | null {
  const s = st()
  const goal = doc.goals.find((g) => g.id === id)
  if (!goal) return null
  const quickest = rankByGoal(doc)[goal.id]?.quickest
  return {
    title: goal.title,
    sub: goal.deadline ? `Goal · by ${fmtDate(goal.deadline)}` : 'Goal',
    color: goal.color,
    rename: (title) => dispatch([{ t: 'goal.update', id: goal.id, patch: { title } }]),
    entries: [
      { id: '__rename', label: 'Rename', icon: PenLine },
      { id: 'edit', label: 'Edit goal & deadline', icon: Target, run: () => s.setSide('context', 'goals') },
      { id: 'new', label: 'New path to this goal', icon: Plus, run: () => newPath(goal.id) },
      { id: 'quick', label: 'Highlight the quickest path', icon: Highlighter, disabled: !quickest, run: () => quickest && s.setHighlight(quickest) },
      { id: 'fw', label: 'What’s next toward it', icon: Telescope, kbd: 'W', run: () => s.setSide('forward') },
      { id: 'ai', label: 'Ask AI for more paths here', icon: Sparkles, run: () => ask(`Generate 2–3 genuinely different paths to the goal “${goal.title}”, then compare them.`) },
      '-',
      {
        id: 'del',
        label: 'Delete goal',
        icon: Trash2,
        danger: true,
        disabled: doc.goals.length <= 1,
        confirm: 'Click again — its paths move to another goal',
        run: () => dispatch([{ t: 'goal.delete', id: goal.id }]),
      },
    ],
  }
}

function startMenu(doc: Pathway): MenuSpec {
  const s = st()
  return {
    title: doc.current.title || 'Where you are now',
    sub: 'Where you are now',
    entries: [
      { id: 'change', label: 'Change where you are', icon: MapPin, run: () => s.setSide('context', 'now') },
      { id: 'fw', label: 'Forward — what’s next everywhere', icon: Telescope, kbd: 'W', run: () => s.setSide('forward') },
      { id: 'signal', label: 'Log something that changed', icon: Activity, run: () => s.setSide('context', 'signals') },
      { id: 'new', label: 'New path', icon: Plus, run: () => newPath(doc.goals[0]?.id) },
      '-',
      {
        id: 'reset',
        label: 'Move every path back to its start',
        icon: RotateCcw,
        danger: true,
        confirm: 'Click again to reset positions',
        disabled: !doc.paths.some((p) => p.currentNodeId),
        run: () => setCurrent(null),
      },
    ],
  }
}

function edgeMenu(doc: Pathway, t: Extract<MenuTarget, { kind: 'edge' }>): MenuSpec | null {
  const s = st()
  const a = doc.nodes.find((n) => n.id === t.source)
  const b = doc.nodes.find((n) => n.id === t.target)
  const pathId = t.insert?.pathId ?? b?.pathId ?? a?.pathId
  const path = doc.paths.find((p) => p.id === pathId)
  const real = !!a && !!b && b.dependsOn.includes(a.id)
  return {
    title: 'Connection',
    sub: `${a?.title ?? doc.current.title ?? 'Start'} → ${b?.title ?? 'goal'}`,
    color: path?.color,
    entries: [
      { id: 'insert', label: 'Insert a step here', icon: Plus, disabled: !t.insert, run: () => t.insert && addStep(t.insert) },
      path ? { id: 'hl', label: 'Highlight this path', icon: Highlighter, run: () => s.setHighlight(path.id) } : null,
      a ? { id: 'from', label: `Go to “${a.title}”`, icon: ArrowLeft, run: () => s.goTo({ nodeId: a.id }) } : null,
      b ? { id: 'to', label: `Go to “${b.title}”`, icon: ArrowRight, run: () => s.goTo({ nodeId: b.id }) } : null,
      '-',
      {
        id: 'del',
        label: 'Remove this connection',
        icon: Trash2,
        danger: true,
        disabled: !real,
        run: () => dispatch([{ t: 'edge.delete', source: t.source, target: t.target }]),
      },
    ].filter(Boolean) as MenuEntry[],
  }
}

function paneMenu(doc: Pathway): MenuSpec {
  const s = st()
  const scopeNode = s.scope ? doc.nodes.find((n) => n.id === s.scope) : undefined
  const me = mePerson(doc, s.me)
  const live = doc.paths.filter((p) => p.status !== 'archived')
  const entries: (MenuEntry | null | false | undefined | '')[] = [
    scopeNode
      ? { id: 'sub', label: 'Add a sub-step', icon: Plus, run: () => addStep({ pathId: scopeNode.pathId, parentId: scopeNode.id }) }
      : doc.goals.length > 1
        ? {
            id: 'new',
            label: 'New path',
            icon: Plus,
            items: doc.goals.map((g) => ({ id: g.id, label: `Toward ${g.title}`, color: g.color, run: () => newPath(g.id) })),
          }
        : { id: 'new', label: 'New path', icon: Plus, run: () => newPath(doc.goals[0]?.id) },
    scopeNode && { id: 'up', label: `Back out of “${scopeNode.title}”`, icon: ArrowLeft, kbd: 'Esc', run: () => s.enter(scopeNode.parentId) },
    { id: 'fit', label: 'Fit everything', icon: Maximize, run: () => window.dispatchEvent(new Event(FIT_EVENT)) },
    { id: 'fog', label: s.fog ? 'Lift the fog' : 'Focus fog', icon: s.fog ? EyeOff : Eye, kbd: 'F', run: () => s.toggleFog() },
    s.highlightPathId && { id: 'clear', label: 'Clear highlight', icon: Highlighter, kbd: 'Esc', run: () => s.setHighlight(null) },
    s.focusPathId && { id: 'all', label: 'Show all paths', icon: Focus, run: () => s.setFocusPath(null) },
    me && {
      id: 'mine',
      label: s.personFilter === me.id ? 'Show everyone’s work' : 'Highlight my work',
      icon: User,
      run: () => s.setPersonFilter(me.id),
    },
    '-',
    { id: 'fw', label: 'Forward', icon: Telescope, kbd: 'W', run: () => s.setSide('forward') },
    { id: 'search', label: 'Search', icon: Search, kbd: '⌘K', run: () => s.setSearch(true) },
    { id: 'now', label: 'Where you are & goals', icon: Compass, run: () => s.setSide('context', 'now') },
    { id: 'ai', label: 'Plan with AI', icon: Sparkles, run: () => s.setSide('ai') },
    live.length > 0 && { id: 'goto', label: 'Go to path', icon: ArrowRight, items: live.map((p) => ({ id: p.id, label: p.name, color: p.color, run: () => s.goTo({ pathId: p.id }) })) },
    '-',
    s.navMode === 'trackpad'
      ? { id: 'nav', label: 'Switch to mouse mode', icon: Mouse, run: () => s.setNavMode('mouse') }
      : { id: 'nav', label: 'Switch to trackpad mode', icon: Hand, run: () => s.setNavMode('trackpad') },
  ]
  return {
    title: scopeNode ? scopeNode.title : doc.title,
    sub: scopeNode ? 'Inside a step' : `${live.length} path${live.length === 1 ? '' : 's'} · ${doc.goals.length} goal${doc.goals.length === 1 ? '' : 's'}`,
    entries: entries.filter(Boolean) as MenuEntry[],
  }
}
