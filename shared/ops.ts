// Every change to a pathway is an Op. The web app applies ops optimistically,
// the server applies them authoritatively, and MCP tools are compiled into ops.
// applyOp must stay deterministic: any ids it needs travel inside the op.

import { waitingOnBranch } from './branches'
import { nanoid } from 'nanoid'
import type {
  Attachment,
  Cycle,
  Goal,
  Path,
  PathNode,
  Pathway,
  Person,
  Signal,
} from './types'
import { GOAL_COLORS, PATH_COLORS, PERSON_COLORS } from './types'

export type NodeInput = Partial<Omit<PathNode, 'id' | 'pathId'>> & { id: string; pathId: string; title: string }

export type Op =
  | { t: 'pathway.update'; patch: Partial<Pick<Pathway, 'title' | 'startDate' | 'current' | 'context'>> }
  | { t: 'goal.add'; goal: Partial<Goal> & { id: string; title: string } }
  | { t: 'goal.update'; id: string; patch: Partial<Omit<Goal, 'id'>> }
  | { t: 'goal.delete'; id: string }
  | { t: 'path.add'; path: Partial<Path> & { id: string; name: string } }
  | { t: 'path.update'; id: string; patch: Partial<Omit<Path, 'id'>> }
  | { t: 'path.delete'; id: string }
  | { t: 'path.fork'; id: string; newId: string; name: string; uptoNodeId?: string; idMap?: Record<string, string> }
  | { t: 'node.add'; node: NodeInput; after?: string; before?: string }
  | { t: 'node.update'; id: string; patch: Partial<Omit<PathNode, 'id'>> }
  | { t: 'node.delete'; id: string }
  | { t: 'node.complete'; id: string }
  | { t: 'edge.add'; source: string; target: string }
  | { t: 'edge.delete'; source: string; target: string }
  /** Move "you are here" on a path. nodeId null + pathId = back to that path's start. */
  | { t: 'current.set'; nodeId: string | null; pathId?: string }
  | { t: 'path.pursue'; id: string; on: boolean }
  | { t: 'cycle.log'; id: string; cycle: Cycle }
  | { t: 'person.add'; person: Partial<Person> & { id: string; name: string } }
  | { t: 'person.update'; id: string; patch: Partial<Omit<Person, 'id'>> }
  | { t: 'person.delete'; id: string }
  | { t: 'assign'; nodeId: string; personId: string; on: boolean }
  | { t: 'attachment.add'; target: string | null; attachment: Attachment }
  | { t: 'attachment.delete'; target: string | null; id: string }
  | { t: 'signal.add'; signal: Signal }
  | { t: 'signal.update'; id: string; patch: Partial<Omit<Signal, 'id'>> }
  | { t: 'signal.delete'; id: string }

export const uid = (n = 8) => nanoid(n)
const nowIso = () => new Date().toISOString()

export class OpError extends Error {}

function findNode(p: Pathway, id: string): PathNode {
  const n = p.nodes.find((x) => x.id === id)
  if (!n) throw new OpError(`Unknown step "${id}"`)
  return n
}

function findPath(p: Pathway, id: string): Path {
  const x = p.paths.find((y) => y.id === id)
  if (!x) throw new OpError(`Unknown path "${id}"`)
  return x
}

export function makeNode(input: NodeInput, now = nowIso()): PathNode {
  return {
    parentId: null,
    description: '',
    kind: 'step',
    status: 'todo',
    dependsOn: [],
    durationDays: 3,
    confidence: 0.8,
    cost: 0,
    requirements: [],
    assignees: [],
    attachments: [],
    createdBy: 'user',
    createdAt: now,
    updatedAt: now,
    ...input,
    ...(input.kind === 'recurring' && !input.recurrence ? { recurrence: { cadence: 'weekly', cycles: [] } } : {}),
  } as PathNode
}

/** Nodes that list `id` as a dependency. */
export function successors(p: Pathway, id: string) {
  return p.nodes.filter((n) => n.dependsOn.includes(id))
}

/** Would adding source -> target create a cycle? */
export function createsCycle(p: Pathway, source: string, target: string) {
  if (source === target) return true
  // walk dependencies of source; if we reach target, target already precedes source
  const seen = new Set<string>()
  const stack = [source]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === target) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const n = p.nodes.find((x) => x.id === cur)
    if (n) stack.push(...n.dependsOn)
  }
  return false
}

function descendants(p: Pathway, id: string): string[] {
  const out: string[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of p.nodes) if (n.parentId === cur) {
      out.push(n.id)
      stack.push(n.id)
    }
  }
  return out
}

function touch(n: PathNode, now: string) {
  n.updatedAt = now
}

function applyStatusTimestamps(n: PathNode, prev: PathNode['status'], now: string) {
  if (n.status === prev) return
  if ((n.status === 'in_progress' || n.status === 'done') && !n.startedAt) n.startedAt = now
  if (n.status === 'done' && !n.completedAt) n.completedAt = now
  if (n.status !== 'done') delete n.completedAt
  if (n.status === 'todo') delete n.startedAt
}

/** Fill in ids / defaults the caller left out. Run on the server before applying. */
export function prepareOp(op: Op, p: Pathway): Op {
  if (op.t === 'path.fork' && !op.idMap) {
    const idMap: Record<string, string> = {}
    for (const n of p.nodes) if (n.pathId === op.id) idMap[n.id] = uid()
    return { ...op, idMap }
  }
  return op
}

export function applyOp(p: Pathway, op: Op, now = nowIso()): void {
  switch (op.t) {
    case 'pathway.update': {
      const { current, ...rest } = op.patch
      Object.assign(p, rest)
      if (current) p.current = { ...p.current, ...current }
      return
    }
    case 'goal.add': {
      if (p.goals.some((g) => g.id === op.goal.id)) throw new OpError(`Goal "${op.goal.id}" exists`)
      p.goals.push({ description: '', color: GOAL_COLORS[p.goals.length % GOAL_COLORS.length], ...op.goal })
      return
    }
    case 'goal.update': {
      const g = p.goals.find((x) => x.id === op.id)
      if (!g) throw new OpError(`Unknown goal "${op.id}"`)
      if (op.patch.opening && !p.paths.some((x) => x.id === op.patch.opening && x.goalId === g.id)) throw new OpError(`Path "${op.patch.opening}" doesn't lead to that goal`)
      Object.assign(g, op.patch)
      // "" goes back to "the path you're pursuing"
      if (op.patch.opening === '') delete g.opening
      return
    }
    case 'goal.delete': {
      if (p.goals.length <= 1) throw new OpError('A pathway needs at least one goal')
      p.goals = p.goals.filter((g) => g.id !== op.id)
      // paths aimed at a removed goal move to the first remaining goal
      for (const x of p.paths) if (x.goalId === op.id) x.goalId = p.goals[0].id
      return
    }
    case 'path.add': {
      if (p.paths.some((x) => x.id === op.path.id)) throw new OpError(`Path "${op.path.id}" exists`)
      if (op.path.goalId && !p.goals.some((g) => g.id === op.path.goalId)) throw new OpError(`Unknown goal "${op.path.goalId}"`)
      p.paths.push({
        goalId: p.goals[0]?.id ?? '',
        pursuing: false,
        currentNodeId: null,
        description: '',
        color: PATH_COLORS[p.paths.length % PATH_COLORS.length],
        status: 'active',
        createdBy: 'user',
        createdAt: now,
        ...op.path,
      })
      return
    }
    case 'path.update': {
      Object.assign(findPath(p, op.id), op.patch)
      return
    }
    case 'path.delete': {
      findPath(p, op.id)
      p.paths = p.paths.filter((x) => x.id !== op.id)
      for (const g of p.goals) if (g.opening === op.id) delete g.opening
      const gone = new Set(p.nodes.filter((n) => n.pathId === op.id).map((n) => n.id))
      p.nodes = p.nodes.filter((n) => !gone.has(n.id))
      if (p.currentNodeId && gone.has(p.currentNodeId)) p.currentNodeId = null
      return
    }
    case 'path.pursue': {
      const x = findPath(p, op.id)
      x.pursuing = op.on
      if (op.on && x.status === 'proposed') x.status = 'active'
      if (!op.on && p.currentNodeId && p.nodes.find((n) => n.id === p.currentNodeId)?.pathId === x.id) p.currentNodeId = null
      return
    }
    case 'path.fork': {
      const src = findPath(p, op.id)
      const idMap = op.idMap ?? {}
      let keep = p.nodes.filter((n) => n.pathId === op.id)
      if (op.uptoNodeId) {
        // keep the chain of root-level ancestors leading to uptoNodeId (inclusive), plus their sub-steps
        const upto = findNode(p, op.uptoNodeId)
        const anc = new Set<string>()
        const stack = [upto.id]
        while (stack.length) {
          const cur = stack.pop()!
          if (anc.has(cur)) continue
          anc.add(cur)
          stack.push(...findNode(p, cur).dependsOn)
        }
        const withKids = new Set(anc)
        for (const a of anc) for (const d of descendants(p, a)) withKids.add(d)
        keep = keep.filter((n) => withKids.has(n.id))
      }
      p.paths.push({
        ...src,
        id: op.newId,
        name: op.name,
        color: PATH_COLORS[p.paths.length % PATH_COLORS.length],
        status: 'active',
        pursuing: false,
        currentNodeId: src.currentNodeId && keep.some((k) => k.id === src.currentNodeId) ? idMap[src.currentNodeId] ?? null : null,
        createdAt: now,
      })
      const map = (id: string) => idMap[id] ?? `${id}-${op.newId}`
      for (const n of keep) {
        p.nodes.push({
          ...structuredClone(n),
          id: map(n.id),
          pathId: op.newId,
          parentId: n.parentId ? map(n.parentId) : null,
          dependsOn: n.dependsOn.filter((d) => keep.some((k) => k.id === d)).map(map),
          // outcome ids are unique per pathway, so the copy's futures get their own
          ...(n.branch
            ? { branch: { ...structuredClone(n.branch), outcomes: n.branch.outcomes.map((o) => ({ ...o, id: `${o.id}-${op.newId}` })), resolved: n.branch.resolved && `${n.branch.resolved}-${op.newId}` } }
            : {}),
          ...(n.outcomeOf ? { outcomeOf: `${n.outcomeOf}-${op.newId}` } : {}),
          createdAt: now,
          updatedAt: now,
        })
      }
      return
    }
    case 'node.add': {
      if (p.nodes.some((x) => x.id === op.node.id)) throw new OpError(`Step "${op.node.id}" exists`)
      findPath(p, op.node.pathId)
      const node = makeNode(op.node, now)
      if (node.parentId) findNode(p, node.parentId)
      node.dependsOn = node.dependsOn.filter((d) => p.nodes.some((x) => x.id === d))
      if (op.after && !node.dependsOn.includes(op.after)) {
        findNode(p, op.after)
        node.dependsOn.push(op.after)
      }
      p.nodes.push(node)
      if (op.before) {
        const b = findNode(p, op.before)
        if (op.after) b.dependsOn = b.dependsOn.filter((d) => d !== op.after)
        if (!b.dependsOn.includes(node.id)) b.dependsOn.push(node.id)
        touch(b, now)
      }
      return
    }
    case 'node.update': {
      const n = findNode(p, op.id)
      const prev = n.status
      const { id: _ignore, ...patch } = op.patch as Partial<PathNode>
      const wasResolved = n.branch?.resolved
      Object.assign(n, patch)
      // null clears an optional field (undefined doesn't survive JSON)
      for (const [k, v] of Object.entries(patch)) if (v === null && k !== 'parentId') delete (n as unknown as Record<string, unknown>)[k]
      if (n.branch) delete n.branch.assumed
      // settling a fork you're standing on moves you into the branch that happened
      if (n.branch?.resolved && n.branch.resolved !== wasResolved && (n.status === 'done' || n.status === 'skipped')) {
        const first = p.nodes.find((x) => x.outcomeOf === n.branch!.resolved)
        if (first) {
          let moved = false
          for (const path of p.paths) {
            if (path.id === n.pathId && path.currentNodeId === n.id) ((path.currentNodeId = first.id), (moved = true))
          }
          if (p.currentNodeId === n.id) ((p.currentNodeId = first.id), (moved = true))
          if (moved && first.status === 'todo') {
            first.status = 'in_progress'
            applyStatusTimestamps(first, 'todo', now)
            touch(first, now)
          }
        }
      }
      if (n.kind === 'recurring' && !n.recurrence) n.recurrence = { cadence: 'weekly', cycles: [] }
      if (patch.dependsOn) {
        n.dependsOn = patch.dependsOn.filter((d) => d !== n.id && p.nodes.some((x) => x.id === d))
      }
      applyStatusTimestamps(n, prev, now)
      touch(n, now)
      return
    }
    case 'node.delete': {
      const n = findNode(p, op.id)
      const gone = new Set([n.id, ...descendants(p, n.id)])
      for (const s of p.nodes) {
        if (gone.has(s.id) || !s.dependsOn.includes(n.id)) continue
        s.dependsOn = [...new Set([...s.dependsOn.filter((d) => d !== n.id), ...n.dependsOn])]
        touch(s, now)
      }
      p.nodes = p.nodes.filter((x) => !gone.has(x.id))
      const fallback = n.dependsOn[0] ?? n.parentId ?? null
      if (p.currentNodeId && gone.has(p.currentNodeId)) p.currentNodeId = fallback
      const path = p.paths.find((x) => x.id === n.pathId)
      if (path?.currentNodeId && gone.has(path.currentNodeId)) path.currentNodeId = fallback
      return
    }
    case 'node.complete': {
      const n = findNode(p, op.id)
      const prev = n.status
      n.status = 'done'
      applyStatusTimestamps(n, prev, now)
      touch(n, now)
      const path = p.paths.find((x) => x.id === n.pathId)
      const onPath = path && (path.currentNodeId === n.id || (path.pursuing && !path.currentNodeId))
      const onFocus = p.currentNodeId === n.id
      if (onPath || onFocus) {
        // advance to the first successor whose dependencies are all finished
        // at a fork you stay put until you say which way it went
        const next = successors(p, n.id).find(
          (s) =>
            s.status !== 'done' &&
            !waitingOnBranch(p, s) &&
            s.dependsOn.every((d) => {
              const dn = p.nodes.find((x) => x.id === d)
              return !dn || dn.status === 'done' || dn.status === 'skipped'
            }),
        )
        const to = next?.id ?? n.parentId ?? (onPath ? n.id : null)
        if (next && next.status === 'todo') {
          next.status = 'in_progress'
          applyStatusTimestamps(next, 'todo', now)
          touch(next, now)
        }
        if (onPath && path) path.currentNodeId = to
        if (onFocus || onPath) p.currentNodeId = to
      }
      return
    }
    case 'edge.add': {
      const s = findNode(p, op.source)
      const t = findNode(p, op.target)
      if (s.pathId !== t.pathId || s.parentId !== t.parentId) {
        throw new OpError('Steps can only be connected inside the same path and level')
      }
      if (t.dependsOn.includes(s.id)) return
      if (createsCycle(p, s.id, t.id)) throw new OpError('That connection would create a cycle. Use a recurring step for loops.')
      t.dependsOn.push(s.id)
      touch(t, now)
      return
    }
    case 'edge.delete': {
      const t = findNode(p, op.target)
      t.dependsOn = t.dependsOn.filter((d) => d !== op.source)
      touch(t, now)
      return
    }
    case 'current.set': {
      if (op.nodeId) {
        const n = findNode(p, op.nodeId)
        if (n.status === 'todo') {
          n.status = 'in_progress'
          applyStatusTimestamps(n, 'todo', now)
          touch(n, now)
        }
        const path = findPath(p, n.pathId)
        path.currentNodeId = n.id
        path.pursuing = true
        if (path.status === 'proposed') path.status = 'active'
        p.currentNodeId = n.id
      } else if (op.pathId) {
        const path = findPath(p, op.pathId)
        path.currentNodeId = null
        path.pursuing = true
        if (p.currentNodeId && p.nodes.find((n) => n.id === p.currentNodeId)?.pathId === path.id) p.currentNodeId = null
      } else {
        // back to the very start: everyone's position resets
        for (const x of p.paths) x.currentNodeId = null
        p.currentNodeId = null
      }
      return
    }
    case 'cycle.log': {
      const n = findNode(p, op.id)
      if (!n.recurrence) n.recurrence = { cadence: 'weekly', cycles: [] }
      n.recurrence.cycles.push(op.cycle)
      if (op.cycle.value) n.recurrence.current = op.cycle.value
      if (n.status === 'todo') {
        n.status = 'in_progress'
        applyStatusTimestamps(n, 'todo', now)
      }
      touch(n, now)
      return
    }
    case 'person.add': {
      if (p.people.some((x) => x.id === op.person.id)) return
      p.people.push({ color: PERSON_COLORS[p.people.length % PERSON_COLORS.length], ...op.person })
      return
    }
    case 'person.update': {
      const x = p.people.find((y) => y.id === op.id)
      if (!x) throw new OpError(`Unknown person "${op.id}"`)
      Object.assign(x, op.patch)
      return
    }
    case 'person.delete': {
      p.people = p.people.filter((x) => x.id !== op.id)
      for (const n of p.nodes) n.assignees = n.assignees.filter((a) => a !== op.id)
      return
    }
    case 'assign': {
      const n = findNode(p, op.nodeId)
      if (!p.people.some((x) => x.id === op.personId)) throw new OpError(`Unknown person "${op.personId}"`)
      n.assignees = n.assignees.filter((a) => a !== op.personId)
      if (op.on) n.assignees.push(op.personId)
      touch(n, now)
      return
    }
    case 'attachment.add': {
      const list = op.target ? findNode(p, op.target).attachments : p.attachments
      list.push(op.attachment)
      if (op.target) touch(findNode(p, op.target), now)
      return
    }
    case 'attachment.delete': {
      if (op.target) {
        const n = findNode(p, op.target)
        n.attachments = n.attachments.filter((a) => a.id !== op.id)
        touch(n, now)
      } else p.attachments = p.attachments.filter((a) => a.id !== op.id)
      return
    }
    case 'signal.add': {
      p.signals.push(op.signal)
      return
    }
    case 'signal.update': {
      const s = p.signals.find((x) => x.id === op.id)
      if (s) Object.assign(s, op.patch)
      return
    }
    case 'signal.delete': {
      p.signals = p.signals.filter((x) => x.id !== op.id)
      return
    }
  }
}

export function applyOps<T extends Pathway>(p: T, ops: Op[], now = nowIso()): T {
  const next = structuredClone(p)
  for (const op of ops) applyOp(next, op, now)
  return next
}

/** Human-readable summary used for the activity feed and commit messages. */
export function describeOps(p: Pathway, ops: Op[]): string {
  const name = (id: string) => `"${p.nodes.find((n) => n.id === id)?.title ?? id}"`
  const pathName = (id: string) => `"${p.paths.find((x) => x.id === id)?.name ?? id}"`
  const goalName = (id: string) => `"${p.goals.find((x) => x.id === id)?.title ?? id}"`
  const adds = ops.filter((o) => o.t === 'node.add')
  if (adds.length > 1) {
    const paths = [...new Set(adds.map((o) => (o as { node: NodeInput }).node.pathId))]
    const newPaths = ops.filter((o) => o.t === 'path.add') as { path: { name: string } }[]
    if (newPaths.length) return `created path${newPaths.length > 1 ? 's' : ''} ${newPaths.map((x) => `"${x.path.name}"`).join(', ')} with ${adds.length} steps`
    return `added ${adds.length} steps to ${paths.map(pathName).join(', ')}`
  }
  // when steps are added, the rewiring around them is implied
  const shown = adds.length ? ops.filter((o) => o.t !== 'edge.add' && o.t !== 'edge.delete' && o.t !== 'assign' && o.t !== 'person.add') : ops
  const parts = shown.map((op) => {
    switch (op.t) {
      case 'pathway.update':
        return op.patch.current ? 'updated where you are now' : op.patch.context !== undefined ? 'updated the context' : 'updated the pathway'
      case 'goal.add':
        return `added goal "${op.goal.title}"`
      case 'goal.update':
        if (op.patch.opening) return `opened ${goalName(op.id)} with ${pathName(op.patch.opening)}`
        if (op.patch.opening !== undefined) return op.patch.opening === null ? `showed the paths to ${goalName(op.id)} side by side` : `made a playbook for ${goalName(op.id)}`
        return `edited goal "${p.goals.find((g) => g.id === op.id)?.title ?? op.id}"`
      case 'goal.delete':
        return `removed goal "${p.goals.find((g) => g.id === op.id)?.title ?? op.id}"`
      case 'path.add':
        return `created path "${op.path.name}"`
      case 'path.update':
        return op.patch.status === 'active' ? `accepted path ${pathName(op.id)}` : op.patch.status === 'archived' ? `archived path ${pathName(op.id)}` : `edited path ${pathName(op.id)}`
      case 'path.delete':
        return `deleted path ${pathName(op.id)}`
      case 'path.fork':
        return `branched ${pathName(op.id)} into "${op.name}"`
      case 'node.add':
        return `added step "${op.node.title}"`
      case 'node.update':
        if (op.patch.branch?.resolved) {
          const o = op.patch.branch.outcomes.find((x) => x.id === op.patch.branch!.resolved)
          return `${op.patch.branch.mode === 'choice' ? 'chose' : 'settled'} ${name(op.id)}: ${o ? `"${o.label}"` : 'an outcome'}`
        }
        if (op.patch.branch) return `mapped the possible futures after ${name(op.id)}`
        return op.patch.status ? `marked ${name(op.id)} ${op.patch.status.replace('_', ' ')}` : `edited ${name(op.id)}`
      case 'node.delete':
        return `deleted ${name(op.id)}`
      case 'node.complete':
        return `completed ${name(op.id)}`
      case 'edge.add':
        return `connected ${name(op.source)} → ${name(op.target)}`
      case 'edge.delete':
        return `disconnected ${name(op.source)} → ${name(op.target)}`
      case 'current.set':
        return op.nodeId
          ? `moved "you are here" to ${name(op.nodeId)}`
          : op.pathId
            ? `moved "you are here" to the start of ${pathName(op.pathId)}`
            : 'moved "you are here" back to the start'
      case 'path.pursue':
        return `${op.on ? 'started pursuing' : 'stopped pursuing'} ${pathName(op.id)}`
      case 'cycle.log':
        return `logged a cycle on ${name(op.id)}`
      case 'person.add':
        return `added ${op.person.name} to the team`
      case 'person.update':
        return 'edited a teammate'
      case 'person.delete':
        return 'removed a teammate'
      case 'assign':
        return `${op.on ? 'assigned' : 'unassigned'} ${p.people.find((x) => x.id === op.personId)?.name ?? 'someone'} ${op.on ? 'to' : 'from'} ${name(op.nodeId)}`
      case 'attachment.add':
        return `attached "${op.attachment.title}"${op.target ? ` to ${name(op.target)}` : ''}`
      case 'attachment.delete':
        return 'removed an attachment'
      case 'signal.add':
        return op.signal.kind === 'ask' ? `asked the AI: "${op.signal.text.slice(0, 60)}"` : `noted a change: "${op.signal.text.slice(0, 60)}"`
      case 'signal.update':
        return op.patch.resolved ? 'resolved a request' : 'edited a signal'
      case 'signal.delete':
        return 'removed a signal'
    }
  })
  const uniq = [...new Set(parts)]
  return uniq.length > 3 ? `${uniq.slice(0, 3).join(', ')} +${uniq.length - 3} more` : uniq.join(', ')
}

export function newPathway(input: {
  id: string
  title: string
  current: { title: string; description?: string }
  goals: { title: string; description?: string; deadline?: string }[]
  context?: string
  startDate?: string
}): Pathway {
  const now = nowIso()
  return {
    id: input.id,
    title: input.title,
    startDate: input.startDate ?? now.slice(0, 10),
    current: { title: input.current.title, description: input.current.description ?? '' },
    goals: input.goals.map((g, i) => ({
      id: uid(),
      title: g.title,
      description: g.description ?? '',
      deadline: g.deadline || undefined,
      color: GOAL_COLORS[i % GOAL_COLORS.length],
    })),
    context: input.context ?? '',
    people: [],
    paths: [],
    nodes: [],
    attachments: [],
    signals: [],
    currentNodeId: null,
    createdAt: now,
  }
}

/** Bring older files up to date: a single pathway-level "you are here" becomes that path's position. */
export function migratePathway(p: Pathway): Pathway {
  const focus = p.currentNodeId ? p.nodes.find((n) => n.id === p.currentNodeId) : undefined
  for (const x of p.paths) {
    if (x.currentNodeId === undefined) x.currentNodeId = focus?.pathId === x.id ? focus.id : null
    if (x.pursuing === undefined) x.pursuing = focus?.pathId === x.id
    if (x.currentNodeId && !p.nodes.some((n) => n.id === x.currentNodeId)) x.currentNodeId = null
  }
  return p
}
