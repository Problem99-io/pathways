// A goal's paths as a playbook: you open with one path, and the others are
// backup plays you switch to when a fork goes their way ("if the funds pass,
// run the Angel play from the soft-circle"). A backup is entered at the steps
// those forks switch to; its steps before them are its lead-in, which you skip
// when you switch in. Paths no fork reaches are unused plays.

import { ancestorsOf, normalised } from './branches'
import type { Path, PathNode, Pathway } from './types'
import type { Op } from './ops'

export interface PlayWay {
  /** The fork that can switch into this play. */
  forkId: string
  forkTitle: string
  fromPathId: string
  outcomeId: string
  label: string
  probability: number
  mode: 'chance' | 'choice'
  /** The step of this play you'd start at. */
  nodeId: string
  state: 'open' | 'taken' | 'gone'
}

export interface Play {
  path: Path
  role: 'opening' | 'backup' | 'unused'
  /** Switches away from the opening play before you'd reach this one. */
  level: number
  /** Every way into this play from the playbook, nearest the opening first. */
  ways: PlayWay[]
  /** The way the layout hangs this play from. */
  via?: PlayWay
  /** Steps you start at when you switch in. */
  entries: string[]
  /** Steps before the entries, skipped when you switch in. */
  leadIn: string[]
}

export interface Playbook {
  goalId: string
  opening: Path | null
  plays: Play[]
}

const live = (p: Path) => p.status !== 'archived'

/** The path you open with toward a goal, if there's a playbook for it. */
export function openingOf(doc: Pathway, goalId: string): Path | null {
  const g = doc.goals.find((x) => x.id === goalId)
  if (!g || g.opening === null) return null
  const paths = doc.paths.filter((p) => p.goalId === goalId && live(p))
  if (g.opening) return paths.find((p) => p.id === g.opening) ?? null
  const pursued = paths.filter((p) => p.pursuing)
  return pursued.length === 1 && paths.length > 1 ? pursued[0] : null
}

/** Open with this path: you pursue it, and the goal's other paths wait as backups. */
export function openWithOps(doc: Pathway, pathId: string): Op[] {
  const path = doc.paths.find((p) => p.id === pathId)
  if (!path) return []
  return [
    { t: 'goal.update', id: path.goalId, patch: { opening: path.id } },
    ...(path.pursuing ? [] : [{ t: 'path.pursue' as const, id: path.id, on: true }]),
    ...doc.paths.filter((p) => p.goalId === path.goalId && p.id !== path.id && p.pursuing).map((p) => ({ t: 'path.pursue' as const, id: p.id, on: false })),
  ]
}

/** Root-level steps reachable forward from `ids` (inclusive). */
function downstream(roots: PathNode[], ids: Iterable<string>) {
  const out = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const n of roots) if (!out.has(n.id) && n.dependsOn.some((d) => out.has(d))) (out.add(n.id), (grew = true))
  }
  return out
}

export function playbook(doc: Pathway, goalId: string): Playbook {
  const opening = openingOf(doc, goalId)
  const paths = doc.paths.filter((p) => p.goalId === goalId && live(p))
  if (!opening) return { goalId, opening: null, plays: paths.map((path) => ({ path, role: 'unused', level: 0, ways: [], entries: [], leadIn: [] })) }

  const roots = new Map(paths.map((p) => [p.id, doc.nodes.filter((n) => n.pathId === p.id && n.parentId === null)]))
  const level = new Map<string, number>([[opening.id, 0]])
  const entries = new Map<string, Set<string>>()
  const ways = new Map<string, PlayWay[]>()
  // the steps of a play you'd actually run: all of the opening, a backup from its entries on
  const reachable = (pathId: string) =>
    pathId === opening.id ? new Set(roots.get(pathId)!.map((n) => n.id)) : downstream(roots.get(pathId)!, entries.get(pathId) ?? [])

  // keep following switches until no new play or entry turns up
  let grew = true
  while (grew) {
    grew = false
    const seen = new Set<string>()
    for (const pathId of [...level.keys()].sort((a, b) => level.get(a)! - level.get(b)!)) {
      const run = reachable(pathId)
      for (const n of roots.get(pathId)!) {
        if (!run.has(n.id) || !n.branch) continue
        const odds = normalised(n.branch)
        for (const o of n.branch.outcomes) {
          const to = o.jumpTo
          if (!to || to.pathId === opening.id || !roots.has(to.pathId) || !roots.get(to.pathId)!.some((x) => x.id === to.nodeId)) continue
          const key = `${n.id}:${o.id}`
          seen.add(key)
          const list = ways.get(to.pathId) ?? []
          if (!list.some((w) => `${w.forkId}:${w.outcomeId}` === key)) {
            list.push({
              forkId: n.id,
              forkTitle: n.title,
              fromPathId: pathId,
              outcomeId: o.id,
              label: o.label,
              probability: odds.find((x) => x.id === o.id)!.probability,
              mode: n.branch.mode,
              nodeId: to.nodeId,
              state: n.branch.resolved ? (n.branch.resolved === o.id ? 'taken' : 'gone') : 'open',
            })
            ways.set(to.pathId, list)
            grew = true
          }
          const e: Set<string> = entries.get(to.pathId) ?? new Set()
          if (!e.has(to.nodeId)) (e.add(to.nodeId), entries.set(to.pathId, e), (grew = true))
          const lv = level.get(pathId)! + 1
          if ((level.get(to.pathId) ?? Infinity) > lv) (level.set(to.pathId, lv), (grew = true))
        }
      }
    }
  }

  const plays: Play[] = []
  for (const path of paths) {
    if (path.id === opening.id) {
      plays.push({ path, role: 'opening', level: 0, ways: [], entries: [], leadIn: [] })
      continue
    }
    const lv = level.get(path.id)
    if (lv === undefined) {
      plays.push({ path, role: 'unused', level: Infinity, ways: [], entries: [], leadIn: [] })
      continue
    }
    const ent = [...entries.get(path.id)!]
    const run = downstream(roots.get(path.id)!, ent)
    const lead = new Set<string>()
    for (const id of ent) for (const a of ancestorsOf(doc, id)) if (!run.has(a.id) && a.parentId === null) lead.add(a.id)
    const list = (ways.get(path.id) ?? []).sort((a, b) => (level.get(a.fromPathId) ?? 0) - (level.get(b.fromPathId) ?? 0))
    // hang it from the nearest way in, at its earliest entry
    const depth = (id: string) => ancestorsOf(doc, id).length
    const near = list.filter((w) => level.get(w.fromPathId) === lv - 1)
    const via = near.sort((a, b) => depth(a.nodeId) - depth(b.nodeId) || b.probability - a.probability)[0]
    plays.push({ path, role: 'backup', level: lv, ways: list, via, entries: ent, leadIn: [...lead] })
  }
  plays.sort((a, b) => a.level - b.level || paths.indexOf(a.path) - paths.indexOf(b.path))
  return { goalId, opening, plays }
}
