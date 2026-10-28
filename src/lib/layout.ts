// Turns a pathway into positioned graph nodes/edges for one "scope"
// (the root, or the inside of a step) and computes the focus fog.
//
// Layout: NOW on the left, one horizontal lane per path (grouped by goal),
// goals on the right. Inside a step: a single lane between an entry and an
// exit node; for recurring steps the exit loops back to the entry.

import { Graph, layout as dagreLayout } from '@dagrejs/dagre'
import { children, planningView, plannedWindow, scopeNodes, type PathMetrics } from '../../shared/metrics'
import { deadSet, normalised, outcomeIndex, selectedOutcome, waitingOnBranch } from '../../shared/branches'
import type { Goal, Path, PathNode, PathwayDoc, Person } from '../../shared/types'

export const STEP_W = 264
export const STEP_H = 132
export const START_W = 260
export const START_H = 150
export const GOAL_W = 260
export const GOAL_H = 150
const KID_ROW = 30
const LANE_GAP = 96
const GOAL_GROUP_GAP = 140
const COL_GAP = 150

export const START_ID = '__start'
export const END_ID = '__end'
export const goalNodeId = (id: string) => `__goal:${id}`
export const ghostId = (pathId: string) => `__ghost:${pathId}`
export const laneId = (pathId: string) => `__path:${pathId}`

/** on = part of the highlighted path, off = another path while one is highlighted. */
export type Hl = 'on' | 'off' | null

export type Fog = 0 | 1 | 2 | 3

export interface StepData extends Record<string, unknown> {
  node: PathNode
  path: Path
  fog: Fog
  current: boolean
  next: boolean
  expected: boolean
  past: boolean
  dimmed: boolean
  people: Person[]
  kids: PathNode[]
  expanded: boolean
  due: { label: string; late: boolean } | null
  proposed: boolean
  pursuing: boolean
  hl: Hl
  /** Order of this step within the highlighted path (1-based), for the route numbers. */
  order: number | null
  /** live = part of the future the plan assumes; alt = in another possible future; gone = that future didn't happen. */
  fate: 'live' | 'alt' | 'gone'
  /** Chance this step happens at all, when it's less than certain. */
  reach: number | null
  /** When this step is a fork. */
  fork: StepFork | null
}

export interface StepFork {
  mode: 'chance' | 'choice'
  count: number
  /** Waiting on you: say what happened / decide. */
  needs: 'what_happened' | 'decide' | null
  resolved?: string
  /** Expected days to the goal, best and worst case across this fork's outcomes. */
  range?: [number, number]
}

export interface EdgeOutcome {
  label: string
  probability: number
  mode: 'chance' | 'choice'
  state: 'open' | 'taken' | 'gone'
  /** The outcome the plan assumes right now. */
  planned: boolean
  days?: number
  branchId: string
  /** This future switches to another path (its name). */
  jump?: string
}

export interface LaneData extends Record<string, unknown> {
  path: Path
  goal?: Goal
  metrics?: PathMetrics
  hl: Hl
  quickest: boolean
  multiGoal: boolean
  here: PathNode | null
}

export interface StartData extends Record<string, unknown> {
  title: string
  description: string
  inner?: PathNode
  fog: Fog
  current: boolean
}

export interface GoalData extends Record<string, unknown> {
  goal?: Goal
  inner?: PathNode
  loop?: boolean
  fog: Fog
  best?: { name: string; days: number; color: string; meets?: boolean; forecast: string } | null
  paths: number
  hl: Hl
}

export interface GhostData extends Record<string, unknown> {
  path: Path
}

export interface FlowEdgeData extends Record<string, unknown> {
  color: string
  state: 'done' | 'active' | 'future'
  proposed: boolean
  fog: Fog
  insert?: { pathId: string; parentId: string | null; after?: string; before?: string }
  loop?: boolean
  hl: Hl
  /** This edge leaves a fork for one of its outcomes. */
  outcome?: EdgeOutcome
  fate?: 'alt' | 'gone'
}

export interface LaidOutNode {
  id: string
  type: 'step' | 'start' | 'goal' | 'ghost' | 'lane'
  x: number
  y: number
  w: number
  h: number
  data: StepData | StartData | GoalData | GhostData | LaneData
}

export interface LaidOutEdge {
  id: string
  source: string
  target: string
  type: 'flow' | 'loop'
  data: FlowEdgeData
}

export interface LayoutOptions {
  scope: string | null
  focusPathId: string | null
  highlightPathId: string | null
  fog: boolean
  personFilter: string | null
  expanded: Record<string, boolean>
  metrics: Record<string, PathMetrics>
  best: Record<string, string | null> // goalId -> quickest path id
}

const finished = (n: PathNode) => n.status === 'done' || n.status === 'skipped'

function stepHeight(n: PathNode, kids: number, expanded: boolean) {
  return STEP_H + (expanded && kids ? Math.min(kids, 6) * KID_ROW + 14 : 0) + (n.kind === 'recurring' ? 6 : 0)
}

export function computeLayout(doc: PathwayDoc, o: LayoutOptions) {
  const nodes: LaidOutNode[] = []
  const edges: LaidOutEdge[] = []
  const parent = o.scope ? doc.nodes.find((n) => n.id === o.scope) ?? null : null

  const visiblePaths = parent
    ? doc.paths.filter((p) => p.id === parent.pathId)
    : doc.paths.filter((p) => p.status !== 'archived' && (!o.focusPathId || p.id === o.focusPathId))
  const goals = parent ? [] : doc.goals

  // group lanes by goal, in goal order
  const lanes: { path: Path; goal?: Goal }[] = []
  if (parent) lanes.push({ path: visiblePaths[0] })
  else
    for (const g of goals) for (const p of visiblePaths) if (p.goalId === g.id) lanes.push({ path: p, goal: g })
  // paths pointing at a missing goal
  if (!parent) for (const p of visiblePaths) if (!lanes.some((l) => l.path.id === p.id)) lanes.push({ path: p, goal: goals[0] })

  const scopeList = parent
    ? scopeNodes(doc, parent.pathId, parent.id)
    : doc.nodes.filter((n) => n.parentId === null && lanes.some((l) => l.path.id === n.pathId))
  const scopeIds = new Set(scopeList.map((n) => n.id))
  const laneX = START_W + COL_GAP

  // ---- futures: which steps happen in the planned future, and how likely each is ----
  const gone = deadSet(doc, 'resolved')
  const planDead = deadSet(planningView(doc))
  const forkOf = outcomeIndex(doc)
  const fateOf = (id: string): StepData['fate'] => (gone.has(id) ? 'gone' : planDead.has(id) ? 'alt' : 'live')
  const reachOf = (n: PathNode) => {
    const r = o.metrics[n.pathId]?.futures?.reach[n.id]
    return r !== undefined && r < 0.995 && !gone.has(n.id) ? r : null
  }
  const forkInfo = (n: PathNode): StepFork | null => {
    const b = n.branch
    if (!b?.outcomes.length) return null
    const days = b.outcomes.map((x) => o.metrics[n.pathId]?.futures?.byOutcome[x.id]?.days).filter((d): d is number => d !== undefined)
    return {
      mode: b.mode,
      count: b.outcomes.length,
      needs: b.resolved || gone.has(n.id) ? null : b.mode === 'chance' ? (finished(n) ? 'what_happened' : null) : n.dependsOn.every((d) => { const x = doc.nodes.find((y) => y.id === d); return !x || finished(x) }) ? 'decide' : null,
      resolved: b.outcomes.find((x) => x.id === b.resolved)?.label,
      range: days.length > 1 ? [Math.min(...days), Math.max(...days)] : undefined,
    }
  }
  const edgeOutcome = (from: string, to: PathNode): EdgeOutcome | undefined => {
    if (!to.outcomeOf) return undefined
    const b = forkOf.get(to.outcomeOf)
    if (!b || b.id !== from) return undefined
    const oc = normalised(b.branch!).find((x) => x.id === to.outcomeOf)!
    const resolved = b.branch!.resolved
    return {
      label: oc.label,
      probability: oc.probability,
      mode: b.branch!.mode,
      state: resolved ? (resolved === oc.id ? 'taken' : 'gone') : 'open',
      planned: !resolved && selectedOutcome(planningView(doc).nodes.find((x) => x.id === b.id) ?? b) === oc.id,
      days: o.metrics[b.pathId]?.futures?.byOutcome[oc.id]?.days,
      branchId: b.id,
    }
  }
  const edgeFate = (a?: string, b?: string): FlowEdgeData['fate'] => {
    const f = [a, b].filter(Boolean).map((x) => fateOf(x!))
    return f.includes('gone') ? 'gone' : f.includes('alt') ? 'alt' : undefined
  }

  // ---- lay out each lane with dagre ----
  type Lane = { path: Path; goal?: Goal; items: { n: PathNode; x: number; y: number; h: number }[]; w: number; h: number }
  const laid: Lane[] = []
  for (const l of lanes) {
    const list = scopeList.filter((n) => n.pathId === l.path.id)
    if (!list.length) {
      laid.push({ ...l, items: [], w: STEP_W, h: STEP_H * 0.75 })
      continue
    }
    const g = new Graph()
    g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 92, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    const heights = new Map<string, number>()
    for (const n of list) {
      const h = stepHeight(n, children(doc, n.id).length, !!o.expanded[n.id])
      heights.set(n.id, h)
      g.setNode(n.id, { width: STEP_W, height: h })
    }
    for (const n of list) for (const d of n.dependsOn) if (heights.has(d)) g.setEdge(d, n.id)
    dagreLayout(g)
    const items = list.map((n) => {
      const p = g.node(n.id) as { x: number; y: number }
      const h = heights.get(n.id)!
      return { n, x: p.x - STEP_W / 2, y: p.y - h / 2, h }
    })
    const minY = Math.min(...items.map((i) => i.y))
    for (const i of items) i.y -= minY
    const w = Math.max(...items.map((i) => i.x + STEP_W))
    const h = Math.max(...items.map((i) => i.y + i.h))
    laid.push({ ...l, items, w, h })
  }

  // ---- stack lanes vertically ----
  let y = 0
  const laneY = new Map<string, number>()
  const goalSpan = new Map<string, { top: number; bottom: number }>()
  laid.forEach((l, i) => {
    if (i > 0) y += laid[i - 1].goal?.id !== l.goal?.id ? GOAL_GROUP_GAP : LANE_GAP
    laneY.set(l.path.id, y)
    if (l.goal) {
      const s = goalSpan.get(l.goal.id) ?? { top: y, bottom: y }
      s.bottom = y + l.h
      goalSpan.set(l.goal.id, s)
    }
    y += l.h
  })
  // goals with no visible paths still get a slot
  for (const g of goals) {
    if (goalSpan.has(g.id)) continue
    if (laid.length || goalSpan.size) y += GOAL_GROUP_GAP
    goalSpan.set(g.id, { top: y, bottom: y + GOAL_H })
    y += GOAL_H
  }
  const totalH = Math.max(y, START_H)
  const maxW = Math.max(STEP_W, ...laid.map((l) => l.w))
  const goalX = laneX + maxW + COL_GAP

  // ---- fog: distance forward from "you are here" ----
  const succ = new Map<string, string[]>()
  const add = (a: string, b: string) => succ.set(a, [...(succ.get(a) ?? []), b])
  const exitOf = (pathId: string) => {
    if (parent) return END_ID
    const p = doc.paths.find((x) => x.id === pathId)
    return goalNodeId(p?.goalId ?? goals[0]?.id ?? '')
  }
  for (const n of scopeList) {
    const deps = n.dependsOn.filter((d) => scopeIds.has(d))
    if (!deps.length) add(START_ID, n.id)
    for (const d of deps) add(d, n.id)
    if (!scopeList.some((s) => s.dependsOn.includes(n.id))) add(n.id, exitOf(n.pathId))
  }
  // ---- where you are: one position per pursued path ----
  const inScope = (start: string | null | undefined) => {
    let id = start
    while (id) {
      if (scopeIds.has(id)) return id
      id = doc.nodes.find((n) => n.id === id)?.parentId ?? null
    }
    return null
  }
  const lanePaths = lanes.map((l) => l.path)
  const pursued = lanePaths.filter((x) => x.pursuing)
  // with nothing marked as pursued, every path is measured from the start
  const tracking = pursued.length ? pursued : lanePaths
  const anchorOf = new Map<string, string>() // pathId -> step id or START
  const pins: { id: string; pathId: string | null; color: string }[] = []
  const pin = (id: string, pathId: string | null, color: string) => {
    if (!pins.some((x) => x.id === id)) pins.push({ id, pathId, color })
  }
  for (const x of tracking) {
    const here = inScope(x.currentNodeId)
    anchorOf.set(x.id, here ?? START_ID)
    if (!parent) {
      if (pursued.length) pin(here ?? START_ID, here ? x.id : null, x.color)
    } else if (here || x.currentNodeId === parent.id) pin(here ?? START_ID, here ? x.id : null, x.color)
  }
  if (!parent && !pursued.length) pin(START_ID, null, '#5EEAD4')
  const pinned = pins.length > 0
  // the primary focus, for framing: the most recently moved position if it's here
  const focusId = inScope(doc.currentNodeId)
  const anchor = focusId && pins.some((x) => x.id === focusId) ? focusId : pins[0]?.id ?? START_ID

  // distance forward from each path's own position, along that path only
  const distOf = new Map<string, number>()
  for (const [pathId, a] of anchorOf) {
    const dist = new Map<string, number>([[a, 0]])
    const queue = [a]
    while (queue.length) {
      const cur = queue.shift()!
      for (const nx of succ.get(cur) ?? []) {
        const n = scopeList.find((x) => x.id === nx)
        if (!n || n.pathId !== pathId || dist.has(nx)) continue
        // don't count finished steps as distance: the fog lifts past work you've done
        dist.set(nx, dist.get(cur)! + (finished(n) ? 0 : 1))
        queue.push(nx)
      }
    }
    for (const [id, d] of dist) if (id !== START_ID) distOf.set(id, d)
  }
  const hlPath = parent ? null : o.highlightPathId && lanes.some((l) => l.path.id === o.highlightPathId) ? o.highlightPathId : null
  const hlOf = (pathId: string): Hl => (hlPath ? (pathId === hlPath ? 'on' : 'off') : null)
  // route numbers along the highlighted path
  const order = new Map<string, number>()
  if (hlPath) {
    const list = scopeList.filter((n) => n.pathId === hlPath)
    const ids = new Set(list.map((n) => n.id))
    const depth = new Map<string, number>()
    const visit = (n: PathNode): number => {
      if (depth.has(n.id)) return depth.get(n.id)!
      depth.set(n.id, 0)
      const d = Math.max(0, ...n.dependsOn.filter((x) => ids.has(x)).map((x) => visit(list.find((y) => y.id === x)!) + 1))
      depth.set(n.id, d)
      return d
    }
    list.forEach(visit)
    ;[...list].sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || laneSort(a, b)).forEach((n, i) => order.set(n.id, i + 1))
  }
  const fogFor = (id: string, n?: PathNode, pathId?: string): Fog => {
    const pid = n?.pathId ?? pathId
    if (hlPath && pid) return pid === hlPath ? 0 : 2
    if (!o.fog) return 0
    const tracked = !!pid && anchorOf.has(pid)
    if (!n) return tracked ? 0 : 3
    if (finished(n)) return tracked ? 0 : 2
    if (!tracked) return 3
    const d = distOf.get(id)
    if (d === undefined) return 1 // unfinished work behind where you are
    if (d <= 1) return 0
    if (d === 2) return 1
    if (d === 3) return 2
    return 3
  }

  // ---- start / entry node ----
  nodes.push({
    id: START_ID,
    type: 'start',
    x: 0,
    y: totalH / 2 - START_H / 2,
    w: START_W,
    h: START_H,
    data: {
      title: parent ? parent.title : doc.current.title,
      description: parent ? parent.description : doc.current.description,
      inner: parent ?? undefined,
      fog: 0,
      current: pins.some((x) => x.id === START_ID),
    } satisfies StartData,
  })

  // ---- steps ----
  for (const l of laid) {
    const ly = laneY.get(l.path.id)!
    const proposed = l.path.status === 'proposed'
    const m = o.metrics[l.path.id]
    if (!parent) {
      nodes.push({
        id: laneId(l.path.id),
        type: 'lane',
        x: laneX,
        y: ly - 66,
        w: Math.max(l.w, STEP_W),
        h: 28,
        data: {
          path: l.path,
          goal: l.goal,
          metrics: m,
          hl: hlOf(l.path.id),
          quickest: !!l.goal && o.best[l.goal.id] === l.path.id,
          multiGoal: goals.length > 1,
          here: l.path.currentNodeId ? doc.nodes.find((n) => n.id === l.path.currentNodeId) ?? null : null,
        } satisfies LaneData,
      })
    }
    if (!l.items.length) {
      nodes.push({
        id: ghostId(l.path.id),
        type: 'ghost',
        x: laneX,
        y: ly,
        w: STEP_W,
        h: STEP_H * 0.75,
        data: { path: l.path } satisfies GhostData,
      })
      edges.push(flowEdge(`e:${START_ID}->${ghostId(l.path.id)}`, START_ID, ghostId(l.path.id), l.path, 'future', fogFor(ghostId(l.path.id), undefined, l.path.id)))
      edges.push(flowEdge(`e:${ghostId(l.path.id)}->${exitOf(l.path.id)}`, ghostId(l.path.id), exitOf(l.path.id), l.path, 'future', fogFor(ghostId(l.path.id), undefined, l.path.id)))
      continue
    }
    for (const it of l.items) {
      const n = it.n
      const kids = children(doc, n.id)
      const win = n.parentId === null || parent ? plannedWindow(doc, n) : null
      let due: StepData['due'] = null
      if (win && !finished(n)) {
        const daysLeft = Math.round((new Date(win.end).getTime() - Date.now()) / 86_400_000)
        if (n.status === 'in_progress' || daysLeft < 0) {
          due = daysLeft < 0 ? { label: `${-daysLeft}d late`, late: true } : { label: daysLeft === 0 ? 'due today' : `due in ${daysLeft}d`, late: false }
        }
      }
      const fog = fogFor(n.id, n)
      nodes.push({
        id: n.id,
        type: 'step',
        x: laneX + it.x,
        y: ly + it.y,
        w: STEP_W,
        h: it.h,
        data: {
          node: n,
          path: l.path,
          fog,
          current: pinned && anchorOf.get(n.pathId) === n.id && pins.some((x) => x.id === n.id),
          next: o.fog && anchorOf.has(n.pathId) && distOf.get(n.id) === 1 && !finished(n) && !waitingOnBranch(doc, n) && fateOf(n.id) !== 'gone',
          expected: !parent && m?.expectedNodeId === n.id && anchorOf.get(n.pathId) !== n.id && !finished(n),
          pursuing: !!l.path.pursuing,
          past: finished(n),
          dimmed: !!o.personFilter && !n.assignees.includes(o.personFilter),
          people: n.assignees.map((a) => doc.people.find((p) => p.id === a)).filter(Boolean) as Person[],
          kids,
          expanded: !!o.expanded[n.id],
          due,
          proposed,
          hl: hlOf(n.pathId),
          order: order.get(n.id) ?? null,
          fate: fateOf(n.id),
          reach: reachOf(n),
          fork: forkInfo(n),
        } satisfies StepData,
      })
    }
    // edges
    const list = l.items.map((i) => i.n)
    for (const n of list) {
      const deps = n.dependsOn.filter((d) => scopeIds.has(d))
      const at = anchorOf.get(l.path.id)
      const st = (src?: PathNode): FlowEdgeData['state'] => (!src ? (at === START_ID ? 'active' : at ? 'done' : 'future') : at === src.id ? 'active' : finished(src) ? 'done' : 'future')
      if (!deps.length) {
        const e = flowEdge(`e:${START_ID}->${n.id}`, START_ID, n.id, l.path, st(), fogFor(n.id, n))
        e.data.insert = { pathId: l.path.id, parentId: parent?.id ?? null, before: n.id }
        e.data.fate = edgeFate(n.id)
        edges.push(e)
      }
      for (const d of deps) {
        const src = list.find((x) => x.id === d)
        const e = flowEdge(`e:${d}->${n.id}`, d, n.id, l.path, st(src), Math.max(fogFor(d, src), fogFor(n.id, n)) as Fog)
        e.data.insert = { pathId: l.path.id, parentId: parent?.id ?? null, after: d, before: n.id }
        e.data.fate = edgeFate(d, n.id)
        const oc = edgeOutcome(d, n)
        if (oc) {
          e.data.outcome = oc
          e.data.insert = undefined
          // a future that didn't happen, or one waiting on the fork, doesn't flow yet
          if (oc.state !== 'taken' && e.data.state === 'active') e.data.state = 'future'
        }
        edges.push(e)
      }
      // futures that switch to another path: a link across to the step you'd start at
      for (const oc of n.branch?.outcomes ?? []) {
        if (!oc.jumpTo || !scopeIds.has(oc.jumpTo.nodeId)) continue
        const to = scopeList.find((x) => x.id === oc.jumpTo!.nodeId)!
        const toPath = doc.paths.find((x) => x.id === to.pathId)
        const prob = normalised(n.branch!).find((x) => x.id === oc.id)!.probability
        const resolved = n.branch!.resolved
        const state: EdgeOutcome['state'] = resolved ? (resolved === oc.id ? 'taken' : 'gone') : 'open'
        const e = flowEdge(`e:jump:${n.id}->${to.id}`, n.id, to.id, l.path, state === 'taken' ? 'done' : 'future', Math.max(fogFor(n.id, n), fogFor(to.id, to)) as Fog)
        e.data.fate = state === 'gone' || gone.has(n.id) ? 'gone' : undefined
        e.data.outcome = {
          label: oc.label,
          probability: prob,
          mode: n.branch!.mode,
          state,
          planned: !resolved && selectedOutcome(planningView(doc).nodes.find((x) => x.id === n.id) ?? n) === oc.id,
          days: o.metrics[n.pathId]?.futures?.byOutcome[oc.id]?.days,
          branchId: n.id,
          jump: toPath?.name,
        }
        edges.push(e)
      }
      if (!list.some((s) => s.dependsOn.includes(n.id))) {
        const target = exitOf(l.path.id)
        const e = flowEdge(`e:${n.id}->${target}`, n.id, target, l.path, at === n.id ? 'active' : finished(n) ? 'done' : 'future', fogFor(n.id, n))
        e.data.insert = { pathId: l.path.id, parentId: parent?.id ?? null, after: n.id }
        e.data.fate = edgeFate(n.id)
        edges.push(e)
      }
    }
  }

  // ---- goals / exit ----
  if (parent) {
    const loop = parent.kind === 'recurring'
    nodes.push({
      id: END_ID,
      type: 'goal',
      x: goalX,
      y: totalH / 2 - GOAL_H / 2,
      w: GOAL_W,
      h: GOAL_H,
      data: { inner: parent, loop, fog: 0, paths: 1, hl: null } satisfies GoalData,
    })
    if (loop) {
      const path = visiblePaths[0]
      edges.push({
        id: 'e:loop',
        source: END_ID,
        target: START_ID,
        type: 'loop',
        data: { color: path?.color ?? '#5EEAD4', state: 'active', proposed: false, fog: 0, loop: true, hl: null },
      })
    }
  } else {
    for (const g of goals) {
      const span = goalSpan.get(g.id)!
      const bestId = o.best[g.id]
      const bp = bestId ? doc.paths.find((p) => p.id === bestId) : null
      const bm = bestId ? o.metrics[bestId] : null
      nodes.push({
        id: goalNodeId(g.id),
        type: 'goal',
        x: goalX,
        y: (span.top + span.bottom) / 2 - GOAL_H / 2,
        w: GOAL_W,
        h: GOAL_H,
        data: {
          goal: g,
          fog: 0,
          hl: hlPath ? (doc.paths.find((p) => p.id === hlPath)?.goalId === g.id ? 'on' : 'off') : null,
          paths: doc.paths.filter((p) => p.goalId === g.id && p.status !== 'archived').length,
          best:
            bp && bm
              ? {
                  name: bp.name,
                  days: bm.expectedDays,
                  color: bp.color,
                  forecast: bm.forecastEnd,
                  meets: g.deadline ? bm.forecastEnd.slice(0, 10) <= g.deadline : undefined,
                }
              : null,
        } satisfies GoalData,
      })
    }
  }

  if (hlPath) {
    for (const e of edges) {
      const src = scopeList.find((n) => n.id === e.source) ?? scopeList.find((n) => n.id === e.target)
      const pathId = src?.pathId ?? (e.source === ghostId(hlPath) || e.target === ghostId(hlPath) ? hlPath : null)
      e.data.hl = pathId ? hlOf(pathId) : null
    }
  }

  return { nodes, edges, width: goalX + GOAL_W, height: totalH, anchor, pinned, pins }
}

function flowEdge(id: string, source: string, target: string, path: Path, state: FlowEdgeData['state'], fog: Fog): LaidOutEdge {
  return {
    id,
    source,
    target,
    type: 'flow',
    data: { color: path.color, state, proposed: path.status === 'proposed', fog, hl: null },
  }
}

const laneSort = (a: PathNode, b: PathNode) => a.createdAt.localeCompare(b.createdAt)
