// MCP tools for Pathways. Every tool is compiled into ops and sent to the
// running Pathways server, so changes appear live in the app.

import fs from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { rankByGoal, rankPaths, pathMetrics, children, planningView, type Futures } from '../shared/metrics'
import { deadSet, normalised, outcomeIndex } from '../shared/branches'
import { forward } from '../shared/forward'
import { uid, type Op } from '../shared/ops'
import type { Actor, PathNode, PathwayDoc, PathwaySummary } from '../shared/types'

export interface Api {
  list(): Promise<PathwaySummary[]>
  get(id: string): Promise<PathwayDoc>
  create(body: unknown, actor: Actor): Promise<PathwayDoc>
  ops(id: string, ops: Op[], actor: Actor, message?: string): Promise<PathwayDoc>
  upload(id: string, name: string, mime: string, data: Buffer): Promise<{ url: string }>
  unfurl(url: string): Promise<{ title?: string; description?: string; image?: string }>
}

export function httpApi(base: string): Api {
  const call = async <T>(p: string, init?: RequestInit): Promise<T> => {
    let res: Response
    try {
      res = await fetch(base + p, init)
    } catch {
      throw new Error(`Can't reach the Pathways app at ${base}. Start it with \`npm run dev\` in the pathways folder.`)
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
    return body as T
  }
  const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    list: () => call('/api/pathways'),
    get: (id) => call(`/api/pathways/${id}`),
    create: (body, actor) => call('/api/pathways', json({ ...(body as object), actor })),
    ops: (id, ops, actor, message) => call(`/api/pathways/${id}/ops`, json({ ops, actor, message })),
    upload: (id, name, mime, data) =>
      call(`/api/pathways/${id}/assets?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'content-type': mime },
        body: new Uint8Array(data),
      }),
    unfurl: (url) => call(`/api/unfurl?url=${encodeURIComponent(url)}`),
  }
}

// ---------- schemas ----------

const kind = z
  .enum(['step', 'milestone', 'recurring', 'decision', 'research'])
  .describe('step = one-off task; milestone = an intermediate goal / checkpoint on the way (give it a deadline if there is a target date); recurring = an ongoing loop that keeps compounding (content, sales outreach, growing an audience); decision = a fork where you choose; research = find something out')
const status = z.enum(['todo', 'in_progress', 'done', 'blocked', 'skipped'])
const cadence = z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'])

const recurrence = z
  .object({
    cadence,
    metric: z.string().optional().describe('What the loop grows, e.g. "followers", "MRR", "qualified leads"'),
    target: z.string().optional().describe('Target value, e.g. "10k"'),
    current: z.string().optional().describe('Current value, e.g. "1.2k"'),
  })
  .describe('Required for kind=recurring')

const reference = z.object({
  title: z.string(),
  url: z.string().optional(),
  text: z.string().optional().describe('A note, quote or finding'),
})

const stepFields = {
  key: z.string().optional().describe('Your own short handle for this step (e.g. "mvp") so other steps can reference it in dependsOn'),
  title: z.string().describe('Short, verb-first: "Ship landing page"'),
  description: z.string().optional().describe('What done looks like, how to do it, why it matters'),
  kind: kind.optional(),
  durationDays: z.number().min(0).optional().describe('Realistic working-days estimate. For recurring steps: time to get the loop running'),
  confidence: z.number().min(0).max(1).optional().describe('0..1 chance this step works out as planned'),
  cost: z.number().min(0).optional().describe('Estimated money cost'),
  requirements: z.array(z.string()).optional().describe('What must be true / available before or during this step'),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe('Keys (from this call) or existing step ids that must finish first. Omit = depends on the previous step in the list. [] = can start right away (parallel)'),
  assignees: z.array(z.string()).optional().describe('People names; created if they do not exist'),
  recurrence: recurrence.optional(),
  deadline: z.string().optional().describe('ISO target date — mostly for milestones (intermediate goals)'),
  references: z.array(reference).optional(),
}
const leafStep = z.object(stepFields)
const midStep = z.object({ ...stepFields, substeps: z.array(leafStep).optional() })
const step = z.object({
  ...stepFields,
  substeps: z
    .array(midStep)
    .optional()
    .describe('A sub-path inside this step (drill-down). For recurring steps these are the steps of ONE cycle of the loop'),
})
type StepIn = z.infer<typeof midStep> & { substeps?: StepIn[] }

// ---------- helpers ----------

function compileSteps(
  doc: PathwayDoc,
  pathId: string,
  parentId: string | null,
  steps: StepIn[],
  ops: Op[],
  keys: Record<string, string>,
  people: Map<string, string>,
  opts: { after?: string; before?: string } = {},
) {
  let prev: string | undefined = opts.after
  const created: string[] = []
  const resolve = (ref: string) => keys[ref] ?? ref
  for (const s of steps) {
    const id = uid()
    if (s.key) keys[s.key] = id
    keys[s.title] = keys[s.title] ?? id
    const deps = s.dependsOn ? s.dependsOn.map(resolve) : prev ? [prev] : []
    const now = new Date().toISOString()
    ops.push({
      t: 'node.add',
      node: {
        id,
        pathId,
        parentId,
        title: s.title,
        description: s.description ?? '',
        kind: s.kind ?? (s.recurrence ? 'recurring' : 'step'),
        durationDays: s.durationDays ?? (s.kind === 'milestone' ? 0 : 3),
        confidence: s.confidence ?? 0.8,
        cost: s.cost ?? 0,
        dependsOn: deps,
        requirements: (s.requirements ?? []).map((text) => ({ id: uid(), text, done: false })),
        recurrence: s.recurrence ? { ...s.recurrence, cycles: [] } : undefined,
        deadline: s.deadline,
        attachments: (s.references ?? []).map((r) => ({
          id: uid(),
          type: r.url ? 'link' : 'note',
          title: r.title,
          url: r.url,
          text: r.text,
          addedBy: 'AI',
          addedAt: now,
        })),
        createdBy: 'ai',
      },
    })
    for (const name of s.assignees ?? []) {
      ops.push({ t: 'assign', nodeId: id, personId: personId(doc, name, ops, people), on: true })
    }
    if (s.substeps?.length) compileSteps(doc, pathId, id, s.substeps, ops, keys, people)
    created.push(id)
    prev = id
  }
  if (opts.before && prev) {
    // the last new step now leads into `before`
    ops.push({ t: 'edge.add', source: prev, target: opts.before })
    if (opts.after) ops.push({ t: 'edge.delete', source: opts.after, target: opts.before })
  }
  return created
}

function personId(doc: PathwayDoc, name: string, ops: Op[], cache: Map<string, string>) {
  const k = name.trim().toLowerCase()
  if (cache.has(k)) return cache.get(k)!
  const existing = doc.people.find((p) => p.name.toLowerCase() === k)
  if (existing) {
    cache.set(k, existing.id)
    return existing.id
  }
  const id = uid()
  ops.unshift({ t: 'person.add', person: { id, name: name.trim() } })
  cache.set(k, id)
  return id
}

type FutureCtx = { futures: Futures | null; gone: Set<string>; alt: Set<string> }
const futureCtx = (doc: PathwayDoc, pathId: string): FutureCtx => ({ futures: pathMetrics(doc, pathId).futures, gone: deadSet(doc, 'resolved'), alt: deadSet(planningView(doc)) })

function stepView(doc: PathwayDoc, n: PathNode, ctx: FutureCtx = futureCtx(doc, n.pathId)): Record<string, unknown> {
  const kids = children(doc, n.id)
  const out: Record<string, unknown> = {
    id: n.id,
    title: n.title,
    kind: n.kind,
    status: n.status,
    durationDays: n.durationDays,
    confidence: n.confidence,
  }
  if (n.description) out.description = n.description
  if (n.cost) out.cost = n.cost
  if (n.dependsOn.length) out.dependsOn = n.dependsOn
  if (n.assignees.length) out.assignees = n.assignees.map((a) => doc.people.find((p) => p.id === a)?.name ?? a)
  if (n.requirements.length) out.requirements = n.requirements.map((r) => `${r.done ? '[x]' : '[ ]'} ${r.text}`)
  if (n.recurrence) out.recurrence = { ...n.recurrence, cycles: n.recurrence.cycles.length, lastCycle: n.recurrence.cycles.at(-1)?.at }
  if (n.attachments.length) out.references = n.attachments.map((a) => ({ type: a.type, title: a.title, url: a.url, text: a.text?.slice(0, 400) }))
  if (n.deadline) out.deadline = n.deadline
  if (n.startedAt) out.startedAt = n.startedAt
  if (n.completedAt) out.completedAt = n.completedAt
  if (n.branch?.outcomes.length) {
    const b = n.branch
    out.fork = {
      mode: b.mode,
      settled: b.outcomes.find((o) => o.id === b.resolved)?.label ?? null,
      outcomes: normalised(b).map((o) => ({
        id: o.id,
        label: o.label,
        probability: b.mode === 'chance' ? Math.round(o.probability * 100) / 100 : undefined,
        expectedDaysToGoal: ctx.futures?.byOutcome[o.id]?.days,
        firstStepId: doc.nodes.find((x) => x.outcomeOf === o.id)?.id,
      })),
    }
  }
  if (n.outcomeOf) {
    const f = outcomeIndex(doc).get(n.outcomeOf)
    out.onlyIf = { forkStepId: f?.id, outcome: f?.branch?.outcomes.find((o) => o.id === n.outcomeOf)?.label }
  }
  if (ctx.gone.has(n.id)) out.future = 'didnt_happen'
  else if (ctx.alt.has(n.id)) out.future = 'alternative'
  const reach = ctx.futures?.reach[n.id]
  if (reach !== undefined && reach < 0.995 && !ctx.gone.has(n.id)) out.chanceItHappens = Math.round(reach * 100) / 100
  if (kids.length) out.substeps = kids.map((k) => stepView(doc, k, ctx))
  return out
}

export function pathwayView(doc: PathwayDoc) {
  const ranking = rankByGoal(doc)
  return {
    id: doc.id,
    title: doc.title,
    today: new Date().toISOString().slice(0, 10),
    startDate: doc.startDate,
    whereYouAreNow: doc.current,
    goals: doc.goals.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      deadline: g.deadline,
      quickestPath: ranking[g.id]?.quickest,
      mostLikelyPath: ranking[g.id]?.mostLikely,
    })),
    context: doc.context,
    /** The most recently moved position. Each path also has its own youAreHere. */
    focusStepId: doc.currentNodeId,
    pursuing: doc.paths.filter((p) => p.pursuing).map((p) => p.id),
    people: doc.people.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    openRequests: doc.signals.filter((s) => s.kind === 'ask' && !s.resolved),
    recentChanges: doc.signals.filter((s) => s.kind === 'change').slice(-15),
    references: doc.attachments.map((a) => ({ type: a.type, title: a.title, url: a.url, text: a.text?.slice(0, 600) })),
    paths: doc.paths.map((p) => {
      const m = pathMetrics(doc, p.id)
      return {
        id: p.id,
        goalId: p.goalId,
        pursuing: !!p.pursuing,
        youAreHere: p.currentNodeId ?? null,
        name: p.name,
        status: p.status,
        strategy: p.strategy,
        description: p.description,
        assumptions: p.assumptions,
        risks: p.risks,
        metrics: {
          totalDays: m.totalDays,
          remainingDays: m.remainingDays,
          probability: Math.round(m.probability * 100) / 100,
          expectedDays: m.expectedDays,
          cost: m.cost,
          progress: Math.round(m.progress * 100) + '%',
          schedule: m.state,
          milestones: m.milestones.map((x) => ({ id: x.id, title: x.title, done: x.done, deadline: x.deadline, forecast: x.forecast.slice(0, 10), late: x.late })),
          varianceDays: m.varianceDays,
          plannedEnd: m.plannedEnd.slice(0, 10),
          forecastEnd: m.forecastEnd.slice(0, 10),
          futures: futuresView(m.futures),
        },
        steps: (() => {
          const ctx = futureCtx(doc, p.id)
          return doc.nodes.filter((n) => n.pathId === p.id && n.parentId === null).map((n) => stepView(doc, n, ctx))
        })(),
      }
    }),
  }
}

function futuresView(f: Futures | null) {
  if (!f) return undefined
  return {
    openForks: f.points,
    expectedDays: f.expectedDays,
    bestDays: f.bestDays,
    worstDays: f.worstDays,
    scenarios: f.scenarios.slice(0, 8).map((s) => ({ probability: Math.round(s.probability * 100) / 100, days: s.days, outcomes: s.outcomes.map((o) => o.label) })),
  }
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] })
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] })

export const MCP_INSTRUCTIONS = `Pathways is a visual planning graph that runs on the user's computer: where they are now (left) → steps → their goals (right).
A pathway can have several GOALS, and each goal several alternative PATHS that compete to reach it. Steps can have sub-steps (drill-down) and can be RECURRING loops (ongoing work like growing social media).
A step can be a FORK (branch_step): after it the future can go several ways — chance outcomes with probabilities, or choices — each leading to its own steps. The app predicts across every combination (expected days, best/worst, chance each step happens). When reality picks a way, settle_branch.
The user can pursue several paths and goals at the same time; each path has its own "you are here". get_forward shows what's next across all of them.
Workflow: get_pathway → read context, openRequests and recentChanges → create_path several times with genuinely different strategies (status "proposed") → compare_paths → explain the trade-offs.
When things change, record_signal and re-plan: update_step, add_steps, fork_path. Changes appear live in the app. Use the "pathways" skill for the full method.`

export function buildMcpServer(api: Api, clientName?: () => string | undefined) {
  const server = new McpServer({ name: 'pathways', version: '0.1.0' }, { instructions: MCP_INSTRUCTIONS })
  const actor = (): Actor => ({ type: 'ai', name: clientName?.() || prettyClient(server.server.getClientVersion()?.name) || 'AI' })

  const run = async (pathwayId: string, build: (doc: PathwayDoc) => Op[] | Promise<Op[]>, message?: string) => {
    const doc = await api.get(pathwayId)
    const ops = await build(doc)
    return api.ops(pathwayId, ops, actor(), message)
  }

  server.registerTool(
    'list_pathways',
    { title: 'List pathways', description: 'List every pathway (plan) in the workspace with progress.', inputSchema: {} },
    async () => {
      try {
        return text(await api.list())
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'get_pathway',
    {
      title: 'Read a pathway',
      description:
        'Full plan: where the user is now, goal, context, people, open requests, recent changes, references and every path with its steps (nested sub-steps), metrics and schedule status. Always read this before changing anything.',
      inputSchema: { pathwayId: z.string() },
    },
    async ({ pathwayId }) => {
      try {
        return text(pathwayView(await api.get(pathwayId)))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'create_pathway',
    {
      title: 'Create a pathway',
      description: 'Start a new plan from where the user is now to a goal.',
      inputSchema: {
        title: z.string(),
        currentState: z.string().describe('Where the user is right now, one line'),
        currentDetails: z.string().optional(),
        goals: z
          .array(z.object({ title: z.string(), description: z.string().optional(), deadline: z.string().optional().describe('ISO date') }))
          .min(1)
          .describe('One or more goals'),
        context: z.string().optional().describe('Resources, constraints, skills, budget, team, preferences'),
        startDate: z.string().optional().describe('ISO date the plan starts; default today'),
      },
    },
    async (a) => {
      try {
        const doc = await api.create(
          {
            title: a.title,
            current: { title: a.currentState, description: a.currentDetails },
            goals: a.goals,
            context: a.context,
            startDate: a.startDate,
          },
          actor(),
        )
        return text({ pathwayId: doc.id, goals: doc.goals.map((g) => ({ id: g.id, title: g.title })), message: 'Created. Next: create_path for each strategy.' })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'update_pathway',
    {
      title: 'Update a pathway',
      description: 'Change the title, where the user is now, the start date or context. Use set_goal for goals.',
      inputSchema: {
        pathwayId: z.string(),
        title: z.string().optional(),
        currentState: z.string().optional(),
        currentDetails: z.string().optional(),
        context: z.string().optional(),
        startDate: z.string().optional(),
      },
    },
    async (a) => {
      try {
        await run(a.pathwayId, (doc) => [
          {
            t: 'pathway.update',
            patch: {
              ...(a.title ? { title: a.title } : {}),
              ...(a.context !== undefined ? { context: a.context } : {}),
              ...(a.startDate ? { startDate: a.startDate } : {}),
              ...(a.currentState || a.currentDetails
                ? { current: { title: a.currentState ?? doc.current.title, description: a.currentDetails ?? doc.current.description } }
                : {}),
            },
          },
        ])
        return text('Updated.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'set_goal',
    {
      title: 'Add, edit or remove a goal',
      description: 'Without goalId: add a new goal. With goalId: edit it, or remove it with remove=true (its paths move to another goal).',
      inputSchema: {
        pathwayId: z.string(),
        goalId: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        deadline: z.string().optional().describe('ISO date'),
        remove: z.boolean().optional(),
      },
    },
    async ({ pathwayId, goalId, remove, ...fields }) => {
      try {
        const id = goalId ?? uid()
        await run(pathwayId, (): Op[] => {
          if (!goalId) {
            if (!fields.title) throw new Error('title is required for a new goal')
            return [{ t: 'goal.add', goal: { id, title: fields.title, description: fields.description ?? '', deadline: fields.deadline } }]
          }
          if (remove) return [{ t: 'goal.delete', id }]
          return [{ t: 'goal.update', id, patch: fields }]
        })
        return text({ goalId: id })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'create_path',
    {
      title: 'Create a path',
      description:
        'Add one complete alternative route to the goal, with all its steps in one call. Steps run in list order unless dependsOn says otherwise; use dependsOn: [] or keys to express parallel work. Nest substeps for drill-down detail; use kind "recurring" + recurrence for ongoing loops. Create 2–4 genuinely different paths per pathway.',
      inputSchema: {
        pathwayId: z.string(),
        goalId: z.string().optional().describe('Which goal this path reaches; default the first goal'),
        name: z.string().describe('Short memorable name, e.g. "Bootstrap via consulting"'),
        strategy: z.string().describe('The core bet in one sentence'),
        description: z.string().optional(),
        status: z.enum(['proposed', 'active']).optional().describe('proposed (default) lets the user accept or discard it'),
        assumptions: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        steps: z.array(step).min(1),
      },
    },
    async (a) => {
      try {
        const pathId = uid()
        const keys: Record<string, string> = {}
        const out = await run(
          a.pathwayId,
          (doc) => {
            const ops: Op[] = [
              {
                t: 'path.add',
                path: {
                  id: pathId,
                  goalId: a.goalId ?? doc.goals[0]?.id,
                  name: a.name,
                  strategy: a.strategy,
                  description: a.description ?? '',
                  status: a.status ?? 'proposed',
                  assumptions: a.assumptions,
                  risks: a.risks,
                  createdBy: 'ai',
                },
              },
            ]
            compileSteps(doc, pathId, null, a.steps as StepIn[], ops, keys, new Map())
            return ops
          },
        )
        const m = pathMetrics(out, pathId)
        return text({ pathId, stepIds: keys, metrics: { totalDays: m.totalDays, probability: m.probability, expectedDays: m.expectedDays, cost: m.cost } })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'add_steps',
    {
      title: 'Add steps',
      description:
        'Add steps to an existing path. Use parentId to add sub-steps inside a step (or the cycle of a recurring step). Use after/before to insert into a chain.',
      inputSchema: {
        pathwayId: z.string(),
        pathId: z.string(),
        parentId: z.string().optional(),
        after: z.string().optional().describe('Existing step id the first new step follows'),
        before: z.string().optional().describe('Existing step id the last new step leads into'),
        steps: z.array(step).min(1),
      },
    },
    async (a) => {
      try {
        const keys: Record<string, string> = {}
        await run(a.pathwayId, (doc) => {
          const ops: Op[] = []
          compileSteps(doc, a.pathId, a.parentId ?? null, a.steps as StepIn[], ops, keys, new Map(), { after: a.after, before: a.before })
          return ops
        })
        return text({ stepIds: keys })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'update_step',
    {
      title: 'Update a step',
      description: 'Change any field of a step. requirements replaces the list; addRequirements appends; completeRequirements ticks matching items.',
      inputSchema: {
        pathwayId: z.string(),
        stepId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        kind: kind.optional(),
        status: status.optional(),
        durationDays: z.number().min(0).optional(),
        confidence: z.number().min(0).max(1).optional(),
        cost: z.number().min(0).optional(),
        dependsOn: z.array(z.string()).optional(),
        deadline: z.string().optional().describe('ISO target date; empty string clears it'),
        requirements: z.array(z.string()).optional(),
        addRequirements: z.array(z.string()).optional(),
        completeRequirements: z.array(z.string()).optional(),
        recurrence: recurrence.optional(),
      },
    },
    async ({ pathwayId, stepId, requirements, addRequirements, completeRequirements, recurrence: rec, ...rest }) => {
      try {
        await run(pathwayId, (doc) => {
          const n = doc.nodes.find((x) => x.id === stepId)
          if (!n) throw new Error(`Unknown step ${stepId}`)
          let reqs = requirements ? requirements.map((t) => ({ id: uid(), text: t, done: false })) : n.requirements
          if (addRequirements) reqs = [...reqs, ...addRequirements.map((t) => ({ id: uid(), text: t, done: false }))]
          if (completeRequirements) {
            const want = completeRequirements.map((x) => x.toLowerCase())
            reqs = reqs.map((r) => (want.some((w) => r.text.toLowerCase().includes(w)) ? { ...r, done: true } : r))
          }
          const patch: Partial<PathNode> = { ...rest }
          if (rest.deadline === '') patch.deadline = undefined
          if (requirements || addRequirements || completeRequirements) patch.requirements = reqs
          if (rec) patch.recurrence = { cycles: n.recurrence?.cycles ?? [], ...n.recurrence, ...rec }
          return [{ t: 'node.update', id: stepId, patch }]
        })
        return text('Updated.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'delete_step',
    {
      title: 'Delete a step',
      description: 'Remove a step (and its sub-steps). Steps that depended on it are reconnected to its dependencies.',
      inputSchema: { pathwayId: z.string(), stepId: z.string() },
    },
    async (a) => {
      try {
        await run(a.pathwayId, () => [{ t: 'node.delete', id: a.stepId }])
        return text('Deleted.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'connect_steps',
    {
      title: 'Connect / disconnect steps',
      description: '"from" must finish before "to". Both must be in the same path and level. Set remove=true to disconnect.',
      inputSchema: { pathwayId: z.string(), from: z.string(), to: z.string(), remove: z.boolean().optional() },
    },
    async (a) => {
      try {
        await run(a.pathwayId, () => [{ t: a.remove ? 'edge.delete' : 'edge.add', source: a.from, target: a.to }])
        return text('Done.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'set_current_step',
    {
      title: 'Move "you are here" on a path',
      description:
        'Each path has its own "you are here", and the user can pursue several paths (and goals) at once. Setting a step moves that path\'s position there and marks the path as pursued. stepId null + pathId moves that path back to its start; stepId null with no pathId resets every path.',
      inputSchema: { pathwayId: z.string(), stepId: z.string().nullable(), pathId: z.string().optional() },
    },
    async (a) => {
      try {
        await run(a.pathwayId, () => [{ t: 'current.set', nodeId: a.stepId, pathId: a.pathId }])
        return text('Moved.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'complete_step',
    {
      title: 'Complete a step',
      description: 'Mark a step done; "you are here" advances to the next ready step.',
      inputSchema: { pathwayId: z.string(), stepId: z.string() },
    },
    async (a) => {
      try {
        const doc = await run(a.pathwayId, () => [{ t: 'node.complete', id: a.stepId }])
        const n = doc.nodes.find((x) => x.id === a.stepId)
        const path = doc.paths.find((x) => x.id === n?.pathId)
        return text({ pathId: path?.id, youAreHere: path?.currentNodeId ?? null })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'log_cycle',
    {
      title: 'Log a cycle of a recurring step',
      description: 'Record one completed iteration of a recurring loop, optionally with the metric value now.',
      inputSchema: { pathwayId: z.string(), stepId: z.string(), note: z.string().optional(), value: z.string().optional() },
    },
    async (a) => {
      try {
        await run(a.pathwayId, () => [
          { t: 'cycle.log', id: a.stepId, cycle: { id: uid(), at: new Date().toISOString(), note: a.note, value: a.value } },
        ])
        return text('Logged.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'update_path',
    {
      title: 'Update a path',
      description: 'Rename, re-describe, accept (status active), park (archived), re-propose, or start/stop pursuing a path.',
      inputSchema: {
        pathwayId: z.string(),
        pathId: z.string(),
        pursuing: z.boolean().optional().describe('true = the user is actively working this path (alongside any others)'),
        name: z.string().optional(),
        goalId: z.string().optional().describe('Point the path at a different goal'),
        strategy: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['active', 'proposed', 'archived']).optional(),
        assumptions: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
      },
    },
    async ({ pathwayId, pathId, pursuing, ...patch }) => {
      try {
        await run(pathwayId, (): Op[] => [
          ...(Object.keys(patch).length ? [{ t: 'path.update' as const, id: pathId, patch }] : []),
          ...(pursuing !== undefined ? [{ t: 'path.pursue' as const, id: pathId, on: pursuing }] : []),
        ])
        return text('Updated.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'delete_path',
    { title: 'Delete a path', description: 'Delete a path and all its steps.', inputSchema: { pathwayId: z.string(), pathId: z.string() } },
    async (a) => {
      try {
        await run(a.pathwayId, () => [{ t: 'path.delete', id: a.pathId }])
        return text('Deleted.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'fork_path',
    {
      title: 'Branch a path (what-if)',
      description:
        'Copy a path, optionally only up to a step, to explore a what-if alternative from that point. Then add_steps after the copied step.',
      inputSchema: {
        pathwayId: z.string(),
        pathId: z.string(),
        name: z.string(),
        fromStepId: z.string().optional().describe('Copy only this step and everything before it'),
      },
    },
    async (a) => {
      try {
        const newId = uid()
        const doc = await run(a.pathwayId, () => [{ t: 'path.fork', id: a.pathId, newId, name: a.name, uptoNodeId: a.fromStepId }])
        await api.ops(a.pathwayId, [{ t: 'path.update', id: newId, patch: { status: 'proposed', createdBy: 'ai' } }], actor())
        const copied = doc.nodes.filter((n) => n.pathId === newId && n.parentId === null)
        return text({ pathId: newId, steps: copied.map((n) => ({ id: n.id, title: n.title })) })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'assign_people',
    {
      title: 'Assign people',
      description: 'Assign (or unassign) people to a step by name. Unknown names are added to the team.',
      inputSchema: {
        pathwayId: z.string(),
        stepId: z.string(),
        people: z.array(z.string()),
        role: z.string().optional().describe('Role for newly created people'),
        unassign: z.boolean().optional(),
      },
    },
    async (a) => {
      try {
        await run(a.pathwayId, (doc) => {
          const ops: Op[] = []
          const cache = new Map<string, string>()
          for (const name of a.people) ops.push({ t: 'assign', nodeId: a.stepId, personId: personId(doc, name, ops, cache), on: !a.unassign })
          if (a.role) for (const op of ops) if (op.t === 'person.add') op.person.role = a.role
          return ops
        })
        return text('Done.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'add_reference',
    {
      title: 'Attach a reference',
      description:
        'Attach research to a step (or to the whole pathway if stepId is omitted): a link (unfurled automatically), a note with findings, or an image (url, base64 or a local file path).',
      inputSchema: {
        pathwayId: z.string(),
        stepId: z.string().optional(),
        type: z.enum(['link', 'note', 'image', 'file']),
        title: z.string().optional(),
        url: z.string().optional(),
        text: z.string().optional(),
        imageBase64: z.string().optional(),
        mimeType: z.string().optional(),
        filePath: z.string().optional().describe('Absolute path of a local file to upload'),
      },
    },
    async (a) => {
      try {
        let url = a.url
        let title = a.title
        let image: string | undefined
        let description: string | undefined
        if (a.filePath) {
          const data = await fs.readFile(a.filePath)
          const name = path.basename(a.filePath)
          url = (await api.upload(a.pathwayId, name, a.mimeType || mimeFor(name), data)).url
          title = title || name
        } else if (a.imageBase64) {
          const mime = a.mimeType || 'image/png'
          const name = `${uid()}.${mime.split('/')[1] || 'png'}`
          url = (await api.upload(a.pathwayId, name, mime, Buffer.from(a.imageBase64, 'base64'))).url
        } else if (a.type === 'link' && a.url) {
          const meta = await api.unfurl(a.url).catch(() => ({}) as Record<string, string>)
          title = title || meta.title
          image = meta.image
          description = meta.description
        }
        const attachment = {
          id: uid(),
          type: a.type,
          title: title || url || 'Note',
          url,
          text: a.text ?? description,
          image,
          addedBy: actor().name,
          addedAt: new Date().toISOString(),
        }
        await run(a.pathwayId, () => [{ t: 'attachment.add', target: a.stepId ?? null, attachment }])
        return text({ attached: attachment.title, url })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'record_signal',
    {
      title: 'Record a change or request',
      description:
        'kind "change": something happened in the real world that may affect the plan (got funding, lost a client). kind "ask": a question/request for the AI to handle later.',
      inputSchema: { pathwayId: z.string(), kind: z.enum(['change', 'ask']), text: z.string() },
    },
    async (a) => {
      try {
        await run(a.pathwayId, () => [
          { t: 'signal.add', signal: { id: uid(), kind: a.kind, text: a.text, at: new Date().toISOString(), by: actor().name } },
        ])
        return text('Recorded.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'resolve_request',
    {
      title: 'Resolve a request',
      description: 'Mark one of the openRequests as handled once you have acted on it.',
      inputSchema: { pathwayId: z.string(), signalId: z.string() },
    },
    async (a) => {
      try {
        await run(a.pathwayId, () => [{ t: 'signal.update', id: a.signalId, patch: { resolved: true } }])
        return text('Resolved.')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'get_forward',
    {
      title: 'What is next, across everything',
      description:
        'The forward view across every goal and every path the user is pursuing: where they are on each, steps ready to start now (most urgent first), recurring loops and when their next cycle is due, blocked steps, the next milestone per path with its forecast, and the other paths they could take. Use it to answer "what should I do next?" or to plan a week.',
      inputSchema: { pathwayId: z.string(), person: z.string().optional().describe('Only steps assigned to this person (name)') },
    },
    async (a) => {
      try {
        const doc = await api.get(a.pathwayId)
        const personId = a.person ? doc.people.find((p) => p.name.toLowerCase() === a.person!.toLowerCase())?.id ?? null : null
        const f = forward(doc, { personId })
        const step = (r: { node: PathNode; path: { name: string }; goal?: { title: string }; trail: string[]; plannedEnd?: string; late: boolean }) => ({
          id: r.node.id,
          title: r.node.title,
          kind: r.node.kind,
          status: r.node.status,
          path: r.path.name,
          goal: r.goal?.title,
          inside: r.trail.length ? r.trail.join(' › ') : undefined,
          plannedEnd: r.plannedEnd?.slice(0, 10),
          late: r.late || undefined,
          people: r.node.assignees.map((x) => doc.people.find((p) => p.id === x)?.name).filter(Boolean),
        })
        return text({
          note: f.implicit ? 'No path is marked as pursued, so every active path is treated as a front. Ask the user which ones they are really working and set update_path pursuing=true.' : undefined,
          fronts: f.fronts.map((fr) => ({
            pathId: fr.path.id,
            path: fr.path.name,
            goal: fr.goal?.title,
            youAreHere: fr.here ? { id: fr.here.id, title: fr.here.title } : 'start',
            schedule: fr.metrics.state,
            varianceDays: fr.metrics.varianceDays,
            remainingDays: fr.metrics.remainingDays,
            nextMilestone: fr.milestone ? { id: fr.milestone.id, title: fr.milestone.title, forecast: fr.milestone.forecast.slice(0, 10), deadline: fr.milestone.deadline, late: fr.milestone.late } : null,
            ready: fr.ready.length,
          })),
          waitingOnYou: f.settle.length
            ? f.settle.map((r) => ({
                ...step(r),
                ask: r.ask === 'what_happened' ? 'This fork is done: which outcome happened? (settle_branch)' : 'Decide which option to take (settle_branch)',
                outcomes: r.node.branch?.outcomes.map((o) => ({ id: o.id, label: o.label })),
              }))
            : undefined,
          readyNow: f.ready.map(step),
          loops: f.loops.map((l) => ({ ...step(l), cadence: l.node.recurrence?.cadence, metric: l.node.recurrence?.metric, current: l.node.recurrence?.current, target: l.node.recurrence?.target, nextCycleDue: l.dueAt.slice(0, 10), overdue: l.overdue || undefined })),
          comingUp: f.fronts.flatMap((x) => x.upcoming).map(step),
          blocked: f.blocked.map(step),
          otherPaths: f.idle.map((x) => ({ pathId: x.path.id, path: x.path.name, goal: x.goal?.title, status: x.path.status, expectedDays: x.metrics.expectedDays })),
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'branch_step',
    {
      title: 'Map the possible futures after a step',
      description:
        'Turn a step into a fork: after it, the future can go several ways. mode "chance" = it is not up to the user (an investor says yes or no, a launch flops or takes off) and each outcome gets a probability; mode "choice" = the user decides between options. Each outcome leads to its own sequence of steps (same format as add_steps). The app then predicts across every combination of futures: expected time to the goal, best/worst case, how likely each step is to happen, and which choice is quickest. Pass an existing outcome id to change its label or probability. With rejoin "next" (default) whatever already followed the step waits for whichever future happens; "none" lets each future run on to the goal by itself.',
      inputSchema: {
        pathwayId: z.string(),
        stepId: z.string().describe('The step after which things can go several ways'),
        mode: z.enum(['chance', 'choice']).optional().describe('Default chance'),
        outcomes: z
          .array(
            z.object({
              id: z.string().optional().describe('Existing outcome id, to update it'),
              label: z.string().describe('Short: "Raise the seed round", "No — bootstrap instead"'),
              probability: z.number().min(0).max(1).optional().describe('chance mode: how likely (normalised to add up to 1 across outcomes). Be honest, use base rates'),
              description: z.string().optional(),
              steps: z.array(step).optional().describe('The steps this future leads to, in order. Required for new outcomes'),
            }),
          )
          .min(1),
        rejoin: z.enum(['next', 'none']).optional(),
      },
    },
    async (a) => {
      try {
        const created: { outcomeId: string; label: string; firstStepId?: string; stepIds: string[] }[] = []
        await run(a.pathwayId, (doc) => {
          const n = doc.nodes.find((x) => x.id === a.stepId)
          if (!n) throw new Error('Step not found')
          const ops: Op[] = []
          const keys: Record<string, string> = {}
          const people = new Map<string, string>()
          const outcomes = [...(n.branch?.outcomes ?? [])]
          const sinks: string[] = []
          for (const o of a.outcomes) {
            const existing = o.id ? outcomes.find((x) => x.id === o.id) : undefined
            if (existing) {
              Object.assign(existing, { label: o.label, ...(o.probability !== undefined ? { probability: o.probability } : {}), ...(o.description ? { description: o.description } : {}) })
              if (!o.steps?.length) continue
            }
            const oid = existing?.id ?? uid()
            if (!existing) outcomes.push({ id: oid, label: o.label, probability: o.probability ?? 1 / a.outcomes.length, description: o.description })
            if (!o.steps?.length) throw new Error(`Outcome "${o.label}" needs steps`)
            const from = ops.length
            const ids = compileSteps(doc, n.pathId, n.parentId, o.steps as StepIn[], ops, keys, people, { after: n.id })
            // the first step of the branch is the one that only happens in this future
            for (const op of ops.slice(from)) if (op.t === 'node.add' && op.node.id === ids[0]) op.node.outcomeOf = oid
            sinks.push(...ids.filter((id) => !ops.some((op) => op.t === 'node.add' && op.node.dependsOn?.includes(id))))
            created.push({ outcomeId: oid, label: o.label, firstStepId: ids[0], stepIds: ids })
          }
          ops.unshift({ t: 'node.update', id: n.id, patch: { branch: { mode: a.mode ?? n.branch?.mode ?? 'chance', outcomes, resolved: n.branch?.resolved } } })
          if ((a.rejoin ?? 'next') === 'next' && sinks.length) {
            // what came after the fork now waits for whichever future happens
            const fresh = new Set(created.flatMap((c) => c.stepIds))
            for (const s of doc.nodes.filter((x) => x.parentId === n.parentId && x.dependsOn.includes(n.id) && !fresh.has(x.id) && !x.outcomeOf)) {
              ops.push({ t: 'node.update', id: s.id, patch: { dependsOn: [...new Set([...s.dependsOn.filter((d) => d !== n.id), ...sinks])] } })
            }
          }
          return ops
        }, `mapped possible futures`)
        const doc = await api.get(a.pathwayId)
        const n = doc.nodes.find((x) => x.id === a.stepId)!
        return text({ outcomes: created, pathFutures: futuresView(pathMetrics(doc, n.pathId).futures) })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'settle_branch',
    {
      title: 'Say which way a fork went',
      description:
        'Record which outcome actually happened at a chance fork (or which option the user chose). The other futures fade as "didn\'t happen", "you are here" moves into the branch that happened, and the forecasts update. A chance fork is marked done. Pass outcome null to un-settle.',
      inputSchema: {
        pathwayId: z.string(),
        stepId: z.string(),
        outcome: z.string().nullable().describe('Outcome id or label'),
      },
    },
    async (a) => {
      try {
        const doc = await run(a.pathwayId, (doc) => {
          const n = doc.nodes.find((x) => x.id === a.stepId)
          if (!n?.branch) throw new Error('That step is not a fork. Use branch_step first.')
          const o = a.outcome === null ? null : n.branch.outcomes.find((x) => x.id === a.outcome || x.label.toLowerCase() === a.outcome!.toLowerCase())
          if (a.outcome !== null && !o) throw new Error(`No outcome "${a.outcome}". Options: ${n.branch.outcomes.map((x) => x.label).join(', ')}`)
          const ops: Op[] = []
          if (o && n.status !== 'done' && (n.branch.mode === 'chance' || n.kind === 'decision')) ops.push({ t: 'node.complete', id: n.id })
          ops.push({ t: 'node.update', id: n.id, patch: { branch: { ...n.branch, resolved: o?.id } } })
          return ops
        })
        const n = doc.nodes.find((x) => x.id === a.stepId)!
        const path = doc.paths.find((x) => x.id === n.pathId)
        const m = pathMetrics(doc, n.pathId)
        return text({ youAreHere: path?.currentNodeId ?? null, expectedDays: m.expectedDays, forecastEnd: m.forecastEnd.slice(0, 10), stillOpenFutures: futuresView(m.futures) })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'compare_paths',
    {
      title: 'Compare paths',
      description:
        'Per goal, rank paths by expected time to goal (remaining critical path with each step stretched by 1/confidence, i.e. retrying failed steps), probability that everything goes to plan, and cost, with planned-vs-actual schedule status.',
      inputSchema: { pathwayId: z.string() },
    },
    async (a) => {
      try {
        const doc = await api.get(a.pathwayId)
        const name = (id: string | null) => doc.paths.find((p) => p.id === id)?.name ?? null
        return text(doc.goals.map((g) => {
          const r = rankPaths(doc, new Date(), g.id)
          return {
          goal: g.title,
          goalId: g.id,
          deadline: g.deadline,
          quickest: name(r.quickest),
          mostLikely: name(r.mostLikely),
          cheapest: name(r.cheapest),
          paths: r.metrics
            .map((m) => ({
              path: name(m.pathId),
              pathId: m.pathId,
              status: doc.paths.find((p) => p.id === m.pathId)?.status,
              expectedDays: m.expectedDays,
              remainingDays: m.remainingDays,
              probability: Math.round(m.probability * 100) + '%',
              cost: m.cost,
              progress: Math.round(m.progress * 100) + '%',
              schedule: m.state,
              varianceDays: m.varianceDays,
              forecastEnd: m.forecastEnd.slice(0, 10),
              meetsDeadline: g.deadline ? m.forecastEnd.slice(0, 10) <= g.deadline : undefined,
              futures: futuresView(m.futures),
            }))
            .sort((x, y) => x.expectedDays - y.expectedDays),
          }
        }))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerPrompt(
    'plan_pathway',
    {
      title: 'Generate paths for a pathway',
      description: 'Read a pathway and generate several alternative paths to its goal.',
      argsSchema: { pathwayId: z.string() },
    },
    ({ pathwayId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use the Pathways tools to plan pathway ${pathwayId}. Read it with get_pathway, handle any openRequests, then for each goal create 2–4 genuinely different proposed paths with create_path (pass goalId) (realistic durations, confidences, requirements, recurring loops where work is ongoing, sub-steps for complex steps). Finish with compare_paths and explain the trade-offs and the quickest route.`,
          },
        },
      ],
    }),
  )

  return server
}

function prettyClient(name?: string) {
  if (!name) return undefined
  if (/claude/i.test(name)) return 'Claude'
  if (/cursor/i.test(name)) return 'Cursor'
  return name
}

function mimeFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  return (
    { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain' }[
      ext ?? ''
    ] ?? 'application/octet-stream'
  )
}
