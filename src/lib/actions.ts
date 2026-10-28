import { uid, type Op } from '../../shared/ops'
import { PATH_COLORS, type NodeKind, type PathNode } from '../../shared/types'
import { useStore } from '../store'

const st = () => useStore.getState()

export function addStep(opts: {
  pathId: string
  parentId: string | null
  after?: string
  before?: string
  dependsOn?: string[]
  title?: string
  kind?: NodeKind
  select?: boolean
}) {
  const id = uid()
  st().dispatch([
    {
      t: 'node.add',
      node: {
        id,
        pathId: opts.pathId,
        parentId: opts.parentId,
        title: opts.title ?? 'New step',
        kind: opts.kind ?? 'step',
        dependsOn: opts.dependsOn ?? [],
      },
      after: opts.after,
      before: opts.before,
    },
  ])
  if (opts.select !== false) st().select(id)
  return id
}

/** A step that runs alongside `n` (same prerequisites). */
export function addParallel(n: PathNode) {
  return addStep({ pathId: n.pathId, parentId: n.parentId, dependsOn: [...n.dependsOn] })
}

export function addNext(n: PathNode) {
  return addStep({ pathId: n.pathId, parentId: n.parentId, after: n.id })
}

export function newPath(goalId?: string, name?: string) {
  const doc = st().doc
  if (!doc) return
  const pathId = uid()
  const stepId = uid()
  const idx = doc.paths.length
  st().dispatch([
    {
      t: 'path.add',
      path: {
        id: pathId,
        name: name ?? `Path ${String.fromCharCode(65 + (idx % 26))}`,
        goalId: goalId ?? doc.goals[0]?.id,
        color: PATH_COLORS[idx % PATH_COLORS.length],
        status: 'active',
      },
    },
    { t: 'node.add', node: { id: stepId, pathId, parentId: null, title: 'First step' } },
  ])
  st().select(stepId)
  return pathId
}

export function forkFrom(n: PathNode) {
  const doc = st().doc
  if (!doc) return
  const src = doc.paths.find((p) => p.id === n.pathId)
  const newId = uid()
  const idMap: Record<string, string> = {}
  for (const x of doc.nodes) if (x.pathId === n.pathId) idMap[x.id] = uid()
  const ops: Op[] = [{ t: 'path.fork', id: n.pathId, newId, name: `${src?.name ?? 'Path'} — what if`, uptoNodeId: n.id, idMap }]
  const nextId = uid()
  ops.push({ t: 'node.add', node: { id: nextId, pathId: newId, parentId: n.parentId ? idMap[n.parentId] : null, title: 'Different next step' }, after: idMap[n.id] })
  st().dispatch(ops)
  st().setFocusPath(null)
  st().select(nextId)
}

export function complete(n: PathNode) {
  st().dispatch([{ t: 'node.complete', id: n.id }])
}

/** Move "you are here" on that step's path (null + pathId = back to that path's start). */
export function setCurrent(id: string | null, pathId?: string) {
  st().dispatch([{ t: 'current.set', nodeId: id, pathId }])
}

export function pursue(pathId: string, on: boolean) {
  st().dispatch([{ t: 'path.pursue', id: pathId, on }])
}

export function drillInto(n: PathNode) {
  const doc = st().doc
  if (!doc) return
  st().enter(n.id)
  // an empty sub-path gets a first sub-step so there's something to grab
  if (!doc.nodes.some((x) => x.parentId === n.id)) {
    const id = uid()
    st().dispatch([
      {
        t: 'node.add',
        node: { id, pathId: n.pathId, parentId: n.id, title: n.kind === 'recurring' ? 'First step of each cycle' : 'First sub-step', durationDays: 1 },
      },
    ])
    st().select(id)
  }
}

export function removeStep(id: string) {
  st().dispatch([{ t: 'node.delete', id }])
  if (st().selectedId === id) st().select(null)
}

/**
 * Turn a step into a fork with two possible futures, each starting with its own
 * step. Whatever came after the step now waits for whichever future happens.
 */
export function addFutures(n: PathNode, mode: 'chance' | 'choice') {
  const doc = st().doc
  if (!doc) return
  const a = uid()
  const b = uid()
  const outcomes =
    mode === 'chance'
      ? [
          { id: a, label: 'It works out', probability: 0.6 },
          { id: b, label: 'It doesn’t', probability: 0.4 },
        ]
      : [
          { id: a, label: 'Option A', probability: 0.5 },
          { id: b, label: 'Option B', probability: 0.5 },
        ]
  const s1 = uid()
  const s2 = uid()
  const after = doc.nodes.filter((x) => x.parentId === n.parentId && x.dependsOn.includes(n.id))
  const ops: Op[] = [
    { t: 'node.update', id: n.id, patch: { branch: { mode, outcomes } } },
    { t: 'node.add', node: { id: s1, pathId: n.pathId, parentId: n.parentId, title: mode === 'chance' ? 'If it works out…' : 'Go with option A', dependsOn: [n.id], outcomeOf: a } },
    { t: 'node.add', node: { id: s2, pathId: n.pathId, parentId: n.parentId, title: mode === 'chance' ? 'If it doesn’t…' : 'Go with option B', dependsOn: [n.id], outcomeOf: b } },
    // the futures merge back into what came next
    ...after.map((x): Op => ({ t: 'node.update', id: x.id, patch: { dependsOn: [...x.dependsOn.filter((d) => d !== n.id), s1, s2] } })),
  ]
  st().dispatch(ops)
  st().select(n.id)
}

/** One more way it could go, starting with its own step. */
export function addOutcome(n: PathNode) {
  if (!n.branch) return
  const id = uid()
  const step = uid()
  const label = n.branch.mode === 'chance' ? 'Something else happens' : `Option ${String.fromCharCode(65 + n.branch.outcomes.length)}`
  st().dispatch([
    { t: 'node.update', id: n.id, patch: { branch: { ...n.branch, outcomes: [...n.branch.outcomes, { id, label, probability: 0.2 }] } } },
    { t: 'node.add', node: { id: step, pathId: n.pathId, parentId: n.parentId, title: label, dependsOn: [n.id], outcomeOf: id } },
  ])
}

/** Say which way a fork went (or which option you chose). null = not settled yet. */
export function settleFork(n: PathNode, outcomeId: string | null) {
  if (!n.branch) return
  const ops: Op[] = []
  const done = n.status === 'done' || n.status === 'skipped'
  // knowing what happened means the step itself is behind you
  if (outcomeId && !done && (n.branch.mode === 'chance' || n.kind === 'decision')) ops.push({ t: 'node.complete', id: n.id })
  ops.push({ t: 'node.update', id: n.id, patch: { branch: { ...n.branch, resolved: outcomeId ?? undefined } } })
  st().dispatch(ops)
}

/** Remove the fork: the outcome steps stay, as ordinary steps. */
export function removeFutures(n: PathNode) {
  const doc = st().doc
  if (!doc || !n.branch) return
  const ids = new Set(n.branch.outcomes.map((o) => o.id))
  st().dispatch([
    { t: 'node.update', id: n.id, patch: { branch: null as never } },
    ...doc.nodes.filter((x) => x.outcomeOf && ids.has(x.outcomeOf)).map((x): Op => ({ t: 'node.update', id: x.id, patch: { outcomeOf: null as never } })),
  ])
}
