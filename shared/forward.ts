// "Forward": everything that's next across every goal and every path you're
// pursuing — where you are on each, what's ready to start, which loops are
// due, what's blocked and which milestone is coming up.

import { CADENCE_DAYS, type Goal, type Path, type PathNode, type Pathway } from './types'
import { addDays, children, live as liveSteps, pathMetrics, planningView, plannedWindow, type MilestoneInfo, type PathMetrics } from './metrics'
import { deadSet, isBranch, waitingOnBranch } from './branches'

const finished = (n: PathNode) => n.status === 'done' || n.status === 'skipped'

export interface ForwardStep {
  node: PathNode
  path: Path
  goal?: Goal
  /** Breadcrumb of parent steps, outermost first. */
  trail: string[]
  plannedEnd?: string
  late: boolean
}

export interface ForwardLoop extends ForwardStep {
  dueAt: string
  overdue: boolean
}

export interface ForwardFront {
  path: Path
  goal?: Goal
  metrics: PathMetrics
  here: PathNode | null
  ready: ForwardStep[]
  upcoming: ForwardStep[]
  blocked: ForwardStep[]
  loops: ForwardLoop[]
  milestone: MilestoneInfo | null
  /** Forks waiting on you: say what happened, or decide which way to go. */
  settle: ForwardSettle[]
}

export interface ForwardSettle extends ForwardStep {
  ask: 'what_happened' | 'decide'
}

export interface Forward {
  fronts: ForwardFront[]
  /** Ready steps across every front, most urgent first. */
  ready: ForwardStep[]
  loops: ForwardLoop[]
  blocked: ForwardStep[]
  settle: ForwardSettle[]
  /** Active paths you aren't pursuing yet. */
  idle: { path: Path; goal?: Goal; metrics: PathMetrics }[]
  /** True when nothing is marked as pursued — everything is shown as a candidate front. */
  implicit: boolean
}

export function forward(pw: Pathway, opts: { personId?: string | null; today?: Date } = {}): Forward {
  const today = opts.today ?? new Date()
  // look forward along the future the plan assumes, skipping steps that won't happen
  const p = planningView(pw)
  const gone = deadSet(p)
  const live = p.paths.filter((x) => x.status !== 'archived')
  const pursued = live.filter((x) => x.pursuing)
  const implicit = pursued.length === 0
  const frontPaths = implicit ? live.filter((x) => x.status === 'active') : pursued
  const mine = (n: PathNode) => !opts.personId || n.assignees.includes(opts.personId)

  const trailOf = (n: PathNode) => {
    const out: string[] = []
    let id = n.parentId
    while (id) {
      const x = p.nodes.find((y) => y.id === id)
      if (!x) break
      out.unshift(x.title)
      id = x.parentId
    }
    return out
  }
  const depsDone = (n: PathNode) =>
    n.dependsOn.every((d) => {
      const x = p.nodes.find((y) => y.id === d)
      return !x || finished(x)
    })
  /** A step is open when its deps are done and every ancestor is open. */
  const open = (n: PathNode): boolean => {
    if (!depsDone(n) || waitingOnBranch(p, n)) return false
    const parent = n.parentId ? p.nodes.find((x) => x.id === n.parentId) : undefined
    return parent ? !finished(parent) && open(parent) : true
  }
  const insideLoop = (n: PathNode) => {
    let id = n.parentId
    while (id) {
      const x = p.nodes.find((y) => y.id === id)
      if (!x) return false
      if (x.kind === 'recurring') return true
      id = x.parentId
    }
    return false
  }

  const mk = (n: PathNode, path: Path, goal?: Goal): ForwardStep => {
    const win = plannedWindow(p, n)
    return {
      node: n,
      path,
      goal,
      trail: trailOf(n),
      plannedEnd: win?.end,
      late: !!win && !finished(n) && new Date(win.end) < today,
    }
  }

  const fronts: ForwardFront[] = frontPaths.map((path) => {
    const goal = p.goals.find((g) => g.id === path.goalId)
    const nodes = p.nodes.filter((n) => n.pathId === path.id && !gone.has(n.id))
    const here = path.currentNodeId ? nodes.find((n) => n.id === path.currentNodeId) ?? null : null

    // actionable now: open, unfinished, no unfinished sub-steps of its own, not part of a loop's cycle
    const actionable = nodes.filter(
      (n) => !finished(n) && n.kind !== 'recurring' && !insideLoop(n) && open(n) && !liveSteps(p, children(p, n.id)).some((k) => !finished(k)),
    )
    const ready = actionable.filter((n) => n.status !== 'blocked' && mine(n)).map((n) => mk(n, path, goal))
    const blocked = nodes.filter((n) => n.status === 'blocked' && mine(n)).map((n) => mk(n, path, goal))

    // the wave after: steps that become open once something ready finishes
    const readyIds = new Set(actionable.map((n) => n.id))
    const upcoming = nodes
      .filter((n) => !finished(n) && !readyIds.has(n.id) && !insideLoop(n) && (n.dependsOn.some((d) => readyIds.has(d)) || !!waitingOnBranch(p, n)) && mine(n))
      .slice(0, 4)
      .map((n) => mk(n, path, goal))

    const loops: ForwardLoop[] = nodes
      .filter((n) => n.kind === 'recurring' && n.status !== 'done' && n.status !== 'skipped' && open(n) && mine(n))
      .map((n) => {
        const every = CADENCE_DAYS[n.recurrence?.cadence ?? 'weekly']
        const last = n.recurrence?.cycles.at(-1)?.at ?? n.startedAt
        const dueAt = last ? addDays(last, every) : today.toISOString()
        return { ...mk(n, path, goal), dueAt, overdue: new Date(dueAt) < today }
      })

    // forks to settle: a chance step that's done (what happened?) or a choice you can make now
    const settle: ForwardSettle[] = nodes
      .filter((n) => isBranch(n) && !n.branch!.resolved && mine(n))
      .filter((n) => (n.branch!.mode === 'chance' ? finished(n) : open(n) || finished(n)))
      .map((n) => ({ ...mk(n, path, goal), ask: n.branch!.mode === 'chance' ? 'what_happened' : 'decide' }))

    const metrics = pathMetrics(pw, path.id, today)
    return {
      settle,
      path,
      goal,
      metrics,
      here,
      ready,
      upcoming,
      blocked,
      loops,
      milestone: metrics.milestones.find((m) => !m.done) ?? null,
    }
  })

  const byUrgency = (a: ForwardStep, b: ForwardStep) => (a.plannedEnd ?? '9').localeCompare(b.plannedEnd ?? '9')
  return {
    fronts,
    ready: fronts.flatMap((f) => f.ready).sort(byUrgency),
    loops: fronts.flatMap((f) => f.loops).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    blocked: fronts.flatMap((f) => f.blocked),
    settle: fronts.flatMap((f) => f.settle),
    idle: implicit
      ? []
      : live
          .filter((x) => !x.pursuing)
          .map((path) => ({ path, goal: p.goals.find((g) => g.id === path.goalId), metrics: pathMetrics(pw, path.id, today) })),
    implicit,
  }
}
