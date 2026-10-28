// Git-friendly storage. Each pathway is a folder of small, stable JSON files:
//
//   <workspace>/<pathway-id>/
//     pathway.json        meta: current state, goal, context, people, paths, signals
//     nodes/<id>.json     one file per step — concurrent edits rarely conflict
//     activity.jsonl      append-only log (merge=union in .gitattributes)
//     assets/             uploaded images and files
//
// Files are the source of truth; the in-memory copy is reloaded when they
// change on disk (e.g. after `git pull`).

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ActivityEntry, PathNode, Pathway, PathwayDoc } from '../shared/types'
import { migratePathway } from '../shared/ops'

export const WORKSPACE = path.resolve(process.env.PATHWAYS_DIR || path.join(process.cwd(), 'workspace'))

const NODE_KEYS: (keyof PathNode)[] = [
  'id', 'pathId', 'parentId', 'title', 'description', 'kind', 'status', 'dependsOn', 'durationDays',
  'confidence', 'cost', 'requirements', 'assignees', 'attachments', 'recurrence', 'deadline', 'branch', 'outcomeOf', 'startedAt', 'completedAt',
  'createdBy', 'createdAt', 'updatedAt',
]

const stable = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

function orderNode(n: PathNode) {
  const out: Record<string, unknown> = {}
  for (const k of NODE_KEYS) if (n[k] !== undefined) out[k] = n[k]
  // keep fields this version doesn't know about rather than silently dropping them
  for (const k of Object.keys(n)) if (!(k in out) && (n as unknown as Record<string, unknown>)[k] !== undefined) out[k] = (n as unknown as Record<string, unknown>)[k]
  if (out.branch) delete (out.branch as Record<string, unknown>).assumed
  return out
}

function metaOf(p: Pathway) {
  const { nodes: _n, ...rest } = p as PathwayDoc
  const { rev: _r, activity: _a, ...meta } = rest as Partial<PathwayDoc>
  return {
    id: meta.id,
    title: meta.title,
    startDate: meta.startDate,
    current: meta.current,
    goals: meta.goals,
    context: meta.context,
    currentNodeId: meta.currentNodeId,
    paths: meta.paths,
    people: meta.people,
    attachments: meta.attachments,
    signals: meta.signals,
    createdAt: meta.createdAt,
  }
}

/** What we last wrote / read for each file, so we only touch files that changed. */
const written = new Map<string, string>()

export function ensureWorkspace() {
  fs.mkdirSync(WORKSPACE, { recursive: true })
  const attrs = path.join(WORKSPACE, '.gitattributes')
  if (!fs.existsSync(attrs)) {
    fs.writeFileSync(attrs, '# Activity logs are append-only: keep both sides on merge\n*.jsonl merge=union\n')
  }
  const readme = path.join(WORKSPACE, 'README.md')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      '# Pathways workspace\n\nPlans managed by [Pathways](https://github.com/). Each folder is one pathway; each file in `nodes/` is one step.\nOpen this folder with the Pathways app (`PATHWAYS_DIR=<this folder> npm run dev`) to see and edit it.\n',
    )
  }
}

const dirOf = (id: string) => path.join(WORKSPACE, id)

export async function listIds(): Promise<string[]> {
  const entries = await fsp.readdir(WORKSPACE, { withFileTypes: true })
  const ids: string[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    if (fs.existsSync(path.join(WORKSPACE, e.name, 'pathway.json'))) ids.push(e.name)
  }
  return ids
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    written.set(file, raw)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function load(id: string): Promise<{ pathway: Pathway; activity: ActivityEntry[] } | null> {
  const dir = dirOf(id)
  const meta = await readJson<Omit<Pathway, 'nodes'>>(path.join(dir, 'pathway.json'))
  if (!meta) return null
  const nodes: PathNode[] = []
  const nodeDir = path.join(dir, 'nodes')
  if (fs.existsSync(nodeDir)) {
    for (const f of (await fsp.readdir(nodeDir)).sort()) {
      if (!f.endsWith('.json')) continue
      const n = await readJson<PathNode>(path.join(nodeDir, f))
      if (n?.id) nodes.push(normalizeNode(n))
    }
  }
  const pathway: Pathway = {
    goals: [],
    people: [],
    paths: [],
    attachments: [],
    signals: [],
    context: '',
    currentNodeId: null,
    ...(meta as Partial<Pathway>),
    nodes,
    id,
  } as Pathway
  return { pathway: migratePathway(pathway), activity: await readActivity(id) }
}

function normalizeNode(n: PathNode): PathNode {
  return {
    parentId: null,
    description: '',
    kind: 'step',
    status: 'todo',
    dependsOn: [],
    durationDays: 0,
    confidence: 0.8,
    cost: 0,
    requirements: [],
    assignees: [],
    attachments: [],
    createdBy: 'user',
    ...(n as Partial<PathNode>),
  } as PathNode
}

async function writeIfChanged(file: string, content: string) {
  if (written.get(file) === content) return false
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, content)
  await fsp.rename(tmp, file)
  written.set(file, content)
  return true
}

export async function save(p: Pathway) {
  const dir = dirOf(p.id)
  await writeIfChanged(path.join(dir, 'pathway.json'), stable(metaOf(p)))
  const nodeDir = path.join(dir, 'nodes')
  await fsp.mkdir(nodeDir, { recursive: true })
  const keep = new Set<string>()
  for (const n of p.nodes) {
    const file = path.join(nodeDir, `${n.id}.json`)
    keep.add(`${n.id}.json`)
    await writeIfChanged(file, stable(orderNode(n)))
  }
  for (const f of await fsp.readdir(nodeDir)) {
    if (f.endsWith('.json') && !keep.has(f)) {
      await fsp.rm(path.join(nodeDir, f), { force: true })
      written.delete(path.join(nodeDir, f))
    }
  }
}

export async function remove(id: string) {
  await fsp.rm(dirOf(id), { recursive: true, force: true })
}

export async function appendActivity(id: string, entry: ActivityEntry) {
  const file = path.join(dirOf(id), 'activity.jsonl')
  const line = JSON.stringify(entry) + '\n'
  await fsp.appendFile(file, line)
  written.set(file, (written.get(file) ?? '') + line)
}

async function readActivity(id: string): Promise<ActivityEntry[]> {
  const file = path.join(dirOf(id), 'activity.jsonl')
  try {
    const raw = await fsp.readFile(file, 'utf8')
    written.set(file, raw)
    const entries: ActivityEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line))
      } catch {
        /* skip conflict markers etc */
      }
    }
    // union merges can interleave lines from two people — sort by time
    return entries.sort((a, b) => a.at.localeCompare(b.at)).slice(-150)
  } catch {
    return []
  }
}

export function assetsDir(id: string) {
  return path.join(dirOf(id), 'assets')
}

/** True when a file differs from what we last wrote or read (i.e. someone else changed it). */
export async function changedOnDisk(file: string) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return written.get(file) !== raw
  } catch {
    return written.has(file)
  }
}

/** Has anything in this pathway's folder changed since we last read or wrote it (e.g. a git pull)? */
export async function externallyChanged(id: string) {
  const dir = dirOf(id)
  const files = [path.join(dir, 'pathway.json'), path.join(dir, 'activity.jsonl')]
  const nodeDir = path.join(dir, 'nodes')
  if (fs.existsSync(nodeDir)) for (const f of await fsp.readdir(nodeDir)) if (f.endsWith('.json')) files.push(path.join(nodeDir, f))
  for (const f of files) if (await changedOnDisk(f)) return true
  // a node file we know about was deleted
  for (const k of written.keys()) if (k.startsWith(nodeDir + path.sep) && !fs.existsSync(k)) return true
  return false
}
