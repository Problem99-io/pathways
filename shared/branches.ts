// Branch points: steps after which the future can go several ways. A step
// that begins an outcome's branch has `outcomeOf`; everything downstream of
// it belongs to that branch until branches merge again (a step that depends
// on the ends of several branches happens whichever way things went).
//
// "Dead" steps are ones that won't happen given which outcome is selected at
// each branch point: the one that happened or was chosen, else the one being
// assumed for a scenario, else the default (most likely / first option).

import type { Branch, Outcome, PathNode, Pathway } from './types'
import type { Op } from './ops'

/** Outcomes with probabilities that add up to 1 (choices weigh equally). */
export function normalised(b: Branch): Outcome[] {
  if (b.mode === 'choice') return b.outcomes.map((o) => ({ ...o, probability: 1 / Math.max(1, b.outcomes.length) }))
  const sum = b.outcomes.reduce((a, o) => a + Math.max(0, o.probability || 0), 0)
  return b.outcomes.map((o) => ({ ...o, probability: sum > 0 ? Math.max(0, o.probability || 0) / sum : 1 / b.outcomes.length }))
}

export function defaultOutcome(b: Branch): string | undefined {
  if (!b.outcomes.length) return undefined
  if (b.mode === 'choice') return b.outcomes[0].id
  return normalised(b).reduce((a, o) => (o.probability > a.probability ? o : a)).id
}

export const isBranch = (n: PathNode) => !!n.branch && n.branch.outcomes.length > 0
export const selectedOutcome = (n: PathNode) => (n.branch ? n.branch.resolved ?? n.branch.assumed ?? defaultOutcome(n.branch) : undefined)

const indexCache = new WeakMap<PathNode[], Map<string, PathNode>>()
/** outcome id → the branch step it belongs to */
export function outcomeIndex(p: Pathway): Map<string, PathNode> {
  let m = indexCache.get(p.nodes)
  if (!m) {
    m = new Map()
    for (const n of p.nodes) for (const o of n.branch?.outcomes ?? []) m.set(o.id, n)
    indexCache.set(p.nodes, m)
  }
  return m
}

type Mode = 'selected' | 'resolved'
const deadCache = new WeakMap<PathNode[], Partial<Record<Mode, Set<string>>>>()

/**
 * Steps that won't happen.
 * selected: given the selected outcome at every branch point (see top).
 * resolved: only counting branch points that have actually been settled.
 */
export function deadSet(p: Pathway, mode: Mode = 'selected'): Set<string> {
  const cached = deadCache.get(p.nodes)?.[mode]
  if (cached) return cached
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const idx = outcomeIndex(p)
  const memo = new Map<string, boolean>()
  const dead = (id: string): boolean => {
    const known = memo.get(id)
    if (known !== undefined) return known
    memo.set(id, false) // cycle guard
    const n = byId.get(id)
    if (!n) return false
    let d = !!n.parentId && byId.has(n.parentId) && dead(n.parentId)
    if (!d && n.outcomeOf) {
      const b = idx.get(n.outcomeOf)
      if (b) d = dead(b.id) || (mode === 'resolved' ? !!b.branch!.resolved && b.branch!.resolved !== n.outcomeOf : selectedOutcome(b) !== n.outcomeOf)
    }
    if (!d) {
      const deps = n.dependsOn.filter((x) => byId.has(x))
      // a step happens if any of the ways into it happens
      if (deps.length && deps.every(dead)) d = true
    }
    memo.set(id, d)
    return d
  }
  const out = new Set(p.nodes.filter((n) => dead(n.id)).map((n) => n.id))
  deadCache.set(p.nodes, { ...deadCache.get(p.nodes), [mode]: out })
  return out
}

/** The same pathway, assuming these outcomes at these (unsettled) branch points. */
export function assume(p: Pathway, assign: Map<string, string>): Pathway {
  if (!assign.size) return p
  return {
    ...p,
    nodes: p.nodes.map((n) => (n.branch && !n.branch.resolved && assign.has(n.id) ? { ...n, branch: { ...n.branch, assumed: assign.get(n.id) } } : n)),
  }
}

/** Branch the step is waiting on: outcome steps can't start until their branch is settled. */
export function waitingOnBranch(p: Pathway, n: PathNode): PathNode | null {
  if (!n.outcomeOf) return null
  const b = outcomeIndex(p).get(n.outcomeOf)
  return b && b.branch!.resolved !== n.outcomeOf ? b : null
}

const done = (n: PathNode) => n.status === 'done' || n.status === 'skipped'

/** The outcome currently selected at a fork, if it switches to another path. */
export function jumpOf(n: PathNode) {
  const sel = selectedOutcome(n)
  const o = n.branch?.outcomes.find((x) => x.id === sel)
  return o?.jumpTo ? { outcome: o, ...o.jumpTo } : null
}

/** Steps of the same level that `id` depends on, transitively. */
export function ancestorsOf(p: Pathway, id: string): PathNode[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const out = new Map<string, PathNode>()
  const stack = [...(byId.get(id)?.dependsOn ?? [])]
  while (stack.length) {
    const cur = byId.get(stack.pop()!)
    if (!cur || out.has(cur.id)) continue
    out.set(cur.id, cur)
    stack.push(...cur.dependsOn)
  }
  return [...out.values()]
}

/**
 * Ops to say which way a fork went. A chance fork (or a decision step) is done
 * once you know. If the outcome switches to another path, you start on that
 * path at its step: you pursue it from there, its earlier steps are skipped
 * (the path you were on already covered them), and you stop pursuing the old one.
 */
export function settleOps(p: Pathway, fork: PathNode, outcomeId: string | null): Op[] {
  const b = fork.branch
  if (!b) return []
  const ops: Op[] = []
  if (outcomeId && !done(fork) && (b.mode === 'chance' || fork.kind === 'decision')) ops.push({ t: 'node.complete', id: fork.id })
  ops.push({ t: 'node.update', id: fork.id, patch: { branch: { ...b, resolved: outcomeId ?? undefined } } })
  const jump = b.outcomes.find((o) => o.id === outcomeId)?.jumpTo
  const target = jump && p.nodes.find((n) => n.id === jump.nodeId)
  if (target) {
    for (const a of ancestorsOf(p, target.id)) if (!done(a)) ops.push({ t: 'node.update', id: a.id, patch: { status: 'skipped' } })
    ops.push({ t: 'current.set', nodeId: target.id, pathId: target.pathId })
    if (p.paths.find((x) => x.id === fork.pathId)?.pursuing) ops.push({ t: 'path.pursue', id: fork.pathId, on: false })
  }
  return ops
}
