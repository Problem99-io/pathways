// The prediction engine: critical-path scheduling, success probability,
// expected time-to-goal and planned-vs-actual progress for every path.

import type { PathNode, Pathway } from './types'
import { assume, deadSet, isBranch, jumpOf, normalised } from './branches'

const DAY = 86_400_000

export interface ScheduleEntry {
  es: number // planned start, days from pathway start
  ef: number // planned finish
  dur: number
}

export interface PathMetrics {
  pathId: string
  steps: number
  done: number
  /** Planned length of the path, in days (critical path). */
  totalDays: number
  /** Days of work left on the critical path, ignoring finished steps. */
  remainingDays: number
  /** Chance every remaining step succeeds (product of confidences). */
  probability: number
  /** Remaining critical path with every step stretched by 1/confidence (failed
   *  attempts get retried) — the number the "quickest path" is picked by. */
  expectedDays: number
  cost: number
  progress: number // 0..1 of planned work finished
  plannedProgress: number // 0..1 of planned work that should be finished by today
  /** Positive = ahead of plan, negative = behind, in days. */
  varianceDays: number
  elapsedDays: number
  plannedEnd: string
  forecastEnd: string
  /** The step the plan says you should be on today. */
  expectedNodeId: string | null
  state: 'not_started' | 'ahead' | 'on_track' | 'behind' | 'complete'
  recurring: number
  /** Intermediate goals along the path, in plan order. */
  milestones: MilestoneInfo[]
  /** When the path has open branch points: how the possible futures play out. */
  futures: Futures | null
}

export interface FutureScenario {
  probability: number
  /** Expected days to the goal in this future. */
  days: number
  /** The outcome at each branch point that matters in this future. */
  outcomes: { branchId: string; outcomeId: string; label: string }[]
}

export interface Futures {
  /** Open (unsettled) branch points on this path. */
  points: number
  /** Distinct futures, most likely first (for the choices the plan assumes). */
  scenarios: FutureScenario[]
  /** Probability-weighted expected days to the goal. */
  expectedDays: number
  bestDays: number
  worstDays: number
  /** Chance everything works out, across every future. */
  success: number
  /** How likely each step is to happen at all (0..1), given the planned choices. */
  reach: Record<string, number>
  /** Expected days to the goal if this outcome happens (chance) or is picked (choice). */
  byOutcome: Record<string, { days: number; probability: number }>
  /** The outcome the plan assumes at each open branch point: the most likely one, or the quickest choice. */
  planning: Record<string, string>
}

export interface MilestoneInfo {
  id: string
  title: string
  /** Position on the plan, 0..1 of total planned time. */
  at: number
  plannedDate: string
  deadline?: string
  done: boolean
  completedAt?: string
  /** Forecast date, given current pace. */
  forecast: string
  late: boolean
}

export const daysBetween = (a: string | Date, b: string | Date) =>
  (new Date(b).getTime() - new Date(a).getTime()) / DAY

export const addDays = (d: string | Date, n: number) => new Date(new Date(d).getTime() + n * DAY).toISOString()

export function scopeNodes(p: Pathway, pathId: string | null, parentId: string | null) {
  return p.nodes.filter((n) => n.parentId === parentId && (pathId === null || n.pathId === pathId))
}

export function children(p: Pathway, id: string) {
  return p.nodes.filter((n) => n.parentId === id)
}

/** Only the steps that happen in the future `p` describes (see branches.ts). */
export function live(p: Pathway, nodes: PathNode[]) {
  const dead = deadSet(p)
  return dead.size ? nodes.filter((n) => !dead.has(n.id)) : nodes
}
const kidsOf = (p: Pathway, id: string) => live(p, children(p, id))

/**
 * The top-level steps you'd actually walk on this path: its own (that happen),
 * plus — when a fork switches to another path — that path's steps from the
 * switch point on, starting right after the fork.
 */
export function routeOf(p: Pathway, pathId: string): PathNode[] {
  const own = live(p, scopeNodes(p, pathId, null))
  const out = [...own]
  const seen = new Set(own.map((n) => n.id))
  const queue = own.filter(isBranch)
  while (queue.length) {
    const fork = queue.shift()!
    const j = jumpOf(fork)
    const target = j && p.nodes.find((n) => n.id === j.nodeId && n.parentId === null)
    if (!target || seen.has(target.id)) continue
    // everything on the other path that follows from the step you start at
    const rest = new Map<string, PathNode>([[target.id, target]])
    const stack = [target.id]
    while (stack.length) {
      const cur = stack.pop()!
      for (const n of p.nodes) if (n.parentId === null && n.pathId === target.pathId && n.dependsOn.includes(cur) && !rest.has(n.id)) (rest.set(n.id, n), stack.push(n.id))
    }
    for (const n of live(p, [...rest.values()])) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      const copy = { ...n, dependsOn: n.id === target.id ? [fork.id] : n.dependsOn.filter((d) => rest.has(d)) }
      out.push(copy)
      if (isBranch(n)) queue.push(copy)
    }
  }
  return out
}

/** Route steps plus everything inside them. */
function withInside(p: Pathway, roots: PathNode[]) {
  const out = [...roots]
  const stack = [...roots]
  while (stack.length) for (const k of kidsOf(p, stack.pop()!.id)) (out.push(k), stack.push(k))
  return out
}

/** Planned duration of a step. A step with sub-steps lasts as long as its sub-path. */
export function nodeDuration(p: Pathway, n: PathNode, depth = 0): number {
  const kids = kidsOf(p, n.id)
  if (n.kind === 'recurring' || !kids.length || depth > 20) return Math.max(0, n.durationDays || 0)
  const { total } = schedule(p, kids, depth + 1)
  return Math.max(n.durationDays || 0, total)
}

/** Topological order of a set of nodes (dependencies outside the set are ignored). */
export function topo(nodes: PathNode[]): PathNode[] {
  const ids = new Set(nodes.map((n) => n.id))
  const indeg = new Map(nodes.map((n) => [n.id, n.dependsOn.filter((d) => ids.has(d)).length]))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const out: PathNode[] = []
  while (queue.length) {
    const id = queue.shift()!
    out.push(byId.get(id)!)
    for (const s of nodes) {
      if (!s.dependsOn.includes(id)) continue
      indeg.set(s.id, indeg.get(s.id)! - 1)
      if (indeg.get(s.id) === 0) queue.push(s.id)
    }
  }
  // append anything left (only possible with corrupt data)
  for (const n of nodes) if (!out.includes(n)) out.push(n)
  return out
}

export function schedule(p: Pathway, nodes: PathNode[], depth = 0, durOverride?: (n: PathNode) => number) {
  const map = new Map<string, ScheduleEntry>()
  let total = 0
  for (const n of topo(nodes)) {
    const es = Math.max(0, ...n.dependsOn.map((d) => map.get(d)?.ef ?? 0))
    const dur = durOverride ? durOverride(n) : nodeDuration(p, n, depth)
    const ef = es + dur
    map.set(n.id, { es, ef, dur })
    total = Math.max(total, ef)
  }
  return { map, total }
}

const isFinished = (n: PathNode) => n.status === 'done' || n.status === 'skipped'

/** Expected remaining time of a step, retrying until it works: d / p, recursively through sub-steps. */
function expectedRemaining(p: Pathway, n: PathNode, depth = 0): number {
  if (isFinished(n)) return 0
  const kids = kidsOf(p, n.id)
  if (n.kind !== 'recurring' && kids.length && depth < 20) {
    return schedule(p, kids, depth + 1, (k) => expectedRemaining(p, k, depth + 1)).total
  }
  return (Math.max(0, n.durationDays || 0) * (1 - workDone(p, n))) / clamp(n.confidence ?? 0.8, 0.15, 1)
}

/** Fraction 0..1 of a step that is finished, looking into sub-steps if it has them. */
function workDone(p: Pathway, n: PathNode): number {
  if (isFinished(n)) return 1
  if (n.kind === 'recurring') return n.status === 'in_progress' ? 0.5 : 0
  const kids = kidsOf(p, n.id)
  if (kids.length) {
    const durs = kids.map((k) => Math.max(nodeDuration(p, k), 0.5))
    const tot = durs.reduce((a, b) => a + b, 0)
    return kids.reduce((acc, k, i) => acc + workDone(p, k) * durs[i], 0) / tot
  }
  return n.status === 'in_progress' ? 0.4 : 0
}

export function pathMetrics(pw: Pathway, pathId: string, today = new Date()): PathMetrics {
  // with branch points, plan along the future the plan assumes; the spread comes from `futures`
  const fut = futures(pw, pathId)
  const p = fut ? assume(pw, new Map(Object.entries(fut.planning))) : pw
  const nodes = routeOf(p, pathId)
  const all = withInside(p, nodes)
  const { map, total } = schedule(p, nodes)
  const remaining = schedule(p, nodes, 0, (n) => nodeDuration(p, n) * (1 - workDone(p, n))).total
  const expectedDays = fut ? fut.expectedDays : schedule(p, nodes, 0, (n) => expectedRemaining(p, n)).total

  const probability = fut ? fut.success : successOf(p, all)
  const cost = all.filter((n) => !kidsOf(p, n.id).length).reduce((a, n) => a + (n.cost || 0), 0)

  // planned vs actual, in "work-days" (earned schedule)
  const weight = (id: string) => map.get(id)!.dur
  const totalWork = nodes.reduce((a, n) => a + weight(n.id), 0)
  const plannedWorkAt = (t: number) =>
    nodes.reduce((a, n) => {
      const s = map.get(n.id)!
      if (s.dur === 0) return a
      return a + s.dur * clamp((t - s.es) / s.dur, 0, 1)
    }, 0)
  const actualWork = nodes.reduce((a, n) => a + weight(n.id) * workDone(p, n), 0)

  const elapsed = Math.max(0, daysBetween(p.startDate, today))
  // the time on the plan at which you'd have done the work you've actually done
  let lo = 0
  let hi = total
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (plannedWorkAt(mid) < actualWork) lo = mid
    else hi = mid
  }
  const earned = totalWork > 0 ? (actualWork >= totalWork ? total : lo) : 0
  const started = daysBetween(p.startDate, today) >= 0
  const variance = earned - Math.min(elapsed, total)
  // schedule performance, smoothed so the first days don't swing the forecast wildly
  const K = 7
  const spi = clamp((earned + K) / (Math.min(elapsed, total || elapsed) + K), 0.25, 3)
  const doneCount = all.filter(isFinished).length
  const complete = nodes.length > 0 && nodes.every(isFinished)
  const forecastRemaining = complete ? 0 : (total - earned) / spi

  const expected = topo(nodes).find((n) => {
    const s = map.get(n.id)!
    return s.es <= elapsed && elapsed < s.ef
  })

  let state: PathMetrics['state'] = 'on_track'
  if (complete) state = 'complete'
  else if (!started || (elapsed < 1 && actualWork === 0)) state = 'not_started'
  else if (variance > 1) state = 'ahead'
  else if (variance < -1) state = 'behind'

  const milestones: MilestoneInfo[] = topo(nodes)
    .filter((n) => n.kind === 'milestone')
    .map((n) => {
      const s = map.get(n.id)!
      const forecastDays = isFinished(n) ? 0 : Math.max(0, (s.ef - earned) / spi)
      const forecast = isFinished(n) ? n.completedAt ?? addDays(p.startDate, s.ef) : addDays(today, forecastDays)
      const due = n.deadline ?? addDays(p.startDate, s.ef)
      return {
        id: n.id,
        title: n.title,
        at: total ? s.ef / total : 1,
        plannedDate: addDays(p.startDate, s.ef),
        deadline: n.deadline,
        done: isFinished(n),
        completedAt: n.completedAt,
        forecast,
        late: forecast.slice(0, 10) > due.slice(0, 10),
      }
    })

  return {
    pathId,
    milestones,
    steps: all.length,
    done: doneCount,
    totalDays: round(total),
    remainingDays: round(remaining),
    probability,
    expectedDays: round(expectedDays),
    cost,
    progress: totalWork ? actualWork / totalWork : 0,
    plannedProgress: totalWork ? plannedWorkAt(elapsed) / totalWork : 0,
    varianceDays: round(variance),
    elapsedDays: round(elapsed),
    plannedEnd: addDays(p.startDate, total),
    forecastEnd: addDays(today, forecastRemaining),
    expectedNodeId: expected?.id ?? null,
    state,
    recurring: all.filter((n) => n.kind === 'recurring').length,
    futures: fut,
  }
}

/** Chance every remaining (leaf) step works out. */
function successOf(p: Pathway, all: PathNode[]) {
  return all.filter((n) => !isFinished(n) && !kidsOf(p, n.id).length).reduce((acc, n) => acc * clamp(n.confidence ?? 0.8, 0.05, 1), 1)
}

// ---------- futures: every way the open branch points could go ----------

type Pick = { id: string; outcome: string; p: number }
const MAX_CHANCE = 256
const MAX_CHOICE = 64

/** All combinations of picks (or a seeded sample when there are too many). */
function combos(dims: Pick[][], cap: number, seed: string): { picks: Pick[]; weight: number }[] {
  const total = dims.reduce((a, d) => a * d.length, 1)
  if (total <= cap) {
    let out: { picks: Pick[]; weight: number }[] = [{ picks: [], weight: 1 }]
    for (const d of dims) out = out.flatMap((c) => d.map((x) => ({ picks: [...c.picks, x], weight: c.weight * x.p })))
    return out
  }
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)), (h >>> 0) / 4294967296)
  return Array.from({ length: cap }, () => ({
    picks: dims.map((d) => {
      let r = rnd() * d.reduce((a, x) => a + x.p, 0)
      return d.find((x) => (r -= x.p) <= 0) ?? d[d.length - 1]
    }),
    weight: 1 / cap,
  }))
}

const futuresCache = new WeakMap<PathNode[], Map<string, Futures | null>>()

export function futures(p: Pathway, pathId: string): Futures | null {
  let byPath = futuresCache.get(p.nodes)
  if (!byPath) futuresCache.set(p.nodes, (byPath = new Map()))
  if (byPath.has(pathId)) return byPath.get(pathId)!
  const out = computeFutures(p, pathId)
  byPath.set(pathId, out)
  return out
}

function computeFutures(p: Pathway, pathId: string): Futures | null {
  const gone = deadSet(p, 'resolved')
  const points = p.nodes.filter((n) => n.pathId === pathId && isBranch(n) && !n.branch!.resolved && !gone.has(n.id))
  if (!points.length) return null
  const chance = points.filter((n) => n.branch!.mode === 'chance')
  const choice = points.filter((n) => n.branch!.mode === 'choice')
  const label = new Map(points.flatMap((n) => n.branch!.outcomes.map((o) => [o.id, o.label] as const)))

  const chanceSets = combos(chance.map((n) => normalised(n.branch!).map((o) => ({ id: n.id, outcome: o.id, p: o.probability }))), MAX_CHANCE, pathId)
  const choiceSets = combos(choice.map((n) => n.branch!.outcomes.map((o) => ({ id: n.id, outcome: o.id, p: 1 }))), MAX_CHOICE, pathId + ':c')

  type Run = { assign: Map<string, string>; prob: number; days: number; success: number; q: Pathway; route: PathNode[] }
  const evaluate = (c: Pick[]) =>
    chanceSets.map((ch): Run => {
      const assign = new Map([...c, ...ch.picks].map((x) => [x.id, x.outcome]))
      const q = assume(p, assign)
      const roots = routeOf(q, pathId)
      const all = withInside(q, roots)
      return { assign, prob: ch.weight, q, route: all, days: schedule(q, roots, 0, (n) => expectedRemaining(q, n)).total, success: successOf(q, all) }
    })
  const mean = (runs: Run[]) => {
    const w = runs.reduce((a, r) => a + r.prob, 0) || 1
    return runs.reduce((a, r) => a + r.prob * r.days, 0) / w
  }

  // the plan takes the quickest combination of choices
  const byChoice = choiceSets.map((c) => ({ picks: c.picks, runs: evaluate(c.picks) }))
  const best = byChoice.reduce((a, b) => (mean(b.runs) < mean(a.runs) ? b : a))
  const runs = best.runs

  const byOutcome: Futures['byOutcome'] = {}
  for (const n of chance) {
    for (const o of n.branch!.outcomes) {
      const these = runs.filter((r) => r.assign.get(n.id) === o.id)
      byOutcome[o.id] = { days: round(mean(these)), probability: these.reduce((a, r) => a + r.prob, 0) }
    }
  }
  for (const n of choice) {
    for (const o of n.branch!.outcomes) {
      const these = byChoice.filter((c) => c.picks.some((x) => x.id === n.id && x.outcome === o.id))
      byOutcome[o.id] = { days: round(Math.min(...these.map((c) => mean(c.runs)))), probability: best.picks.some((x) => x.id === n.id && x.outcome === o.id) ? 1 : 0 }
    }
  }

  // how likely each step is to happen at all
  const reach: Record<string, number> = {}
  for (const n of p.nodes) if (n.pathId === pathId) reach[n.id] = 0
  for (const r of runs) for (const n of r.route) reach[n.id] = (reach[n.id] ?? 0) + r.prob

  // distinct futures: only the branch points that are actually reached in each count
  const merged = new Map<string, FutureScenario>()
  for (const r of runs) {
    const dead = deadSet(r.q)
    const outcomes = [...r.assign]
      .filter(([id]) => !dead.has(id))
      .map(([branchId, outcomeId]) => ({ branchId, outcomeId, label: label.get(outcomeId) ?? '' }))
    const key = outcomes.map((o) => o.outcomeId).join('|')
    const cur = merged.get(key)
    if (cur) {
      cur.days = (cur.days * cur.probability + r.days * r.prob) / (cur.probability + r.prob)
      cur.probability += r.prob
    } else merged.set(key, { probability: r.prob, days: r.days, outcomes })
  }
  const scenarios = [...merged.values()].map((x) => ({ ...x, days: round(x.days) })).sort((a, b) => b.probability - a.probability)

  const planning: Record<string, string> = {}
  for (const x of best.picks) planning[x.id] = x.outcome
  for (const n of chance) {
    const top = normalised(n.branch!).reduce((a, o) => (o.probability > a.probability ? o : a))
    planning[n.id] = top.id
  }

  return {
    points: points.length,
    scenarios,
    expectedDays: round(mean(runs)),
    bestDays: round(Math.min(...runs.map((r) => r.days))),
    worstDays: round(Math.max(...runs.map((r) => r.days))),
    success: runs.reduce((a, r) => a + r.prob * r.success, 0) / (runs.reduce((a, r) => a + r.prob, 0) || 1),
    reach,
    byOutcome,
    planning,
  }
}

const planCache = new WeakMap<PathNode[], Pathway>()
/** The pathway along the future every path's plan assumes. */
export function planningView(p: Pathway): Pathway {
  const hit = planCache.get(p.nodes)
  if (hit) return hit
  const assign = new Map<string, string>()
  for (const path of p.paths) {
    const f = futures(p, path.id)
    if (f) for (const [k, v] of Object.entries(f.planning)) assign.set(k, v)
  }
  const out = assume(p, assign)
  planCache.set(p.nodes, out)
  return out
}

export interface Ranking {
  metrics: PathMetrics[]
  quickest: string | null
  mostLikely: string | null
  cheapest: string | null
}

/** Rankings are per goal: paths only compete with other paths to the same goal. */
export function rankByGoal(p: Pathway, today = new Date()): Record<string, Ranking> {
  const out: Record<string, Ranking> = {}
  for (const g of p.goals) out[g.id] = rankPaths(p, today, g.id)
  return out
}

export function rankPaths(p: Pathway, today = new Date(), goalId?: string): Ranking {
  const metrics = p.paths
    .filter((x) => x.status !== 'archived' && (!goalId || x.goalId === goalId))
    .map((x) => pathMetrics(p, x.id, today))
  const usable = metrics.filter((m) => m.steps > 0)
  const pick = (f: (m: PathMetrics) => number) =>
    usable.length ? usable.reduce((a, b) => (f(b) < f(a) ? b : a)).pathId : null
  return {
    metrics,
    quickest: pick((m) => m.expectedDays),
    mostLikely: pick((m) => -m.probability),
    cheapest: usable.length > 1 ? pick((m) => m.cost) : null,
  }
}

/** Planned schedule for a single step at the root of its path (for "due in" badges). */
export function plannedWindow(pw: Pathway, n: PathNode) {
  const p = planningView(pw)
  if (deadSet(p).has(n.id)) return null
  const nodes = live(p, scopeNodes(p, n.pathId, n.parentId))
  const { map } = schedule(p, nodes)
  let offset = 0
  // sub-steps start when their parent starts
  let parent = n.parentId ? p.nodes.find((x) => x.id === n.parentId) : undefined
  while (parent) {
    const w = schedule(p, live(p, scopeNodes(p, parent.pathId, parent.parentId))).map.get(parent.id)
    offset += w?.es ?? 0
    parent = parent.parentId ? p.nodes.find((x) => x.id === parent!.parentId) : undefined
  }
  const s = map.get(n.id)
  if (!s) return null
  return { start: addDays(p.startDate, s.es + offset), end: addDays(p.startDate, s.ef + offset), dur: s.dur }
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v))
}
function round(v: number) {
  return Math.round(v * 10) / 10
}
