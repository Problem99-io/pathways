// Git-friendly storage. Each pathway is a folder of small, stable files, one
// per thing, so two people adding or editing different things never touch the
// same file:
//
//   <workspace>/<pathway-id>/
//     pathway.json        title, start date and where you are now
//     context.md          the background, one paragraph per line
//     goals/<id>.json     one file per goal     (with an `order` for lane order)
//     paths/<id>.json     one file per path     (same)
//     people/<id>.json    one file per teammate (same)
//     refs/<id>.json      one file per reference
//     signals/<id>.json   one file per change or request
//     nodes/<id>.json     one file per step
//     activity.jsonl      append-only log (merge=union in .gitattributes)
//     assets/             uploaded images and files
//   <workspace>/.local/<pathway-id>.json   this computer only: the position you last moved
//
// JSON files merge field by field (scripts/merge-json.mjs, merge=pathways).
// The old layout, with everything in pathway.json, still loads; the next save
// writes the new one. Files are the source of truth; the in-memory copy is
// reloaded when they change on disk (e.g. after `git pull`).

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ActivityEntry, PathNode, Pathway } from '../shared/types'
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
  return { id: p.id, title: p.title, startDate: p.startDate, current: p.current, createdAt: p.createdAt }
}

type Item = { id: string } & Record<string, unknown>
/** Lists kept one file per item. Ordered ones store an `order`; the rest sort by time. */
const LISTS = [
  { key: 'goals', dir: 'goals', ordered: true },
  { key: 'paths', dir: 'paths', ordered: true },
  { key: 'people', dir: 'people', ordered: true },
  { key: 'attachments', dir: 'refs', time: 'addedAt' },
  { key: 'signals', dir: 'signals', time: 'at' },
] as const
type List = (typeof LISTS)[number]
type ListKey = List['key']

const fileName = (id: string) => `${encodeURIComponent(id)}.json`
/** The order each ordered item was last read or written with, by file. */
const orders = new Map<string, number>()

async function readList(dir: string, l: List, old: unknown): Promise<Item[]> {
  const sub = path.join(dir, l.dir)
  const items: { item: Item; order: number }[] = []
  if (fs.existsSync(sub)) {
    for (const f of (await fsp.readdir(sub)).sort()) {
      if (!f.endsWith('.json')) continue
      const file = path.join(sub, f)
      const raw = await readJson<Item & { order?: number }>(file)
      if (!raw?.id) continue
      const { order, ...item } = raw
      if (typeof order === 'number') orders.set(file, order)
      items.push({ item: item as Item, order: typeof order === 'number' ? order : Infinity })
    }
  }
  // the old layout (or an older app) kept the list in pathway.json: keep anything not yet in its own file
  if (Array.isArray(old)) {
    const top = Math.max(-1, ...items.map((x) => (Number.isFinite(x.order) ? x.order : -1)))
    old.forEach((item: Item, i) => {
      if (item?.id && !items.some((x) => x.item.id === item.id)) items.push({ item, order: top + 1 + i })
    })
  }
  if ('ordered' in l) items.sort((a, b) => a.order - b.order || a.item.id.localeCompare(b.item.id))
  else items.sort((a, b) => String(a.item[l.time] ?? '').localeCompare(String(b.item[l.time] ?? '')) || a.item.id.localeCompare(b.item.id))
  return items.map((x) => x.item)
}

async function writeList(dir: string, l: List, list: Item[]) {
  const sub = path.join(dir, l.dir)
  const keep = new Set<string>()
  let last = -Infinity
  for (const item of list) {
    const file = path.join(sub, fileName(item.id))
    keep.add(file)
    let body: Record<string, unknown> = item
    if ('ordered' in l) {
      // keep each item's order unless it's out of sequence now (new, or moved): adding one never renumbers the rest
      let order = orders.get(file)
      if (order === undefined || order <= last) order = Number.isFinite(last) ? Math.floor(last) + 1 : 0
      last = order
      orders.set(file, order)
      body = { ...item, order }
    }
    await writeIfChanged(file, stable(body))
  }
  if (!fs.existsSync(sub)) return
  for (const f of await fsp.readdir(sub)) {
    const file = path.join(sub, f)
    if (f.endsWith('.json') && !keep.has(file)) {
      await fsp.rm(file, { force: true })
      written.delete(file)
      orders.delete(file)
    }
  }
}

const localFile = (id: string) => path.join(WORKSPACE, '.local', `${id}.json`)

/** What we last wrote / read for each file, so we only touch files that changed. */
const written = new Map<string, string>()

/** Make sure a text file has these lines, adding any that are missing (with their comment). */
function ensureLines(file: string, lines: [comment: string, line: string][]) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const have = new Set(cur.split('\n').map((x) => x.trim()))
  const add = lines.filter(([, line]) => !have.has(line)).map(([c, line]) => `# ${c}\n${line}\n`)
  if (add.length) fs.writeFileSync(file, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${add.join('')}`)
}

export function ensureWorkspace() {
  fs.mkdirSync(WORKSPACE, { recursive: true })
  ensureLines(path.join(WORKSPACE, '.gitattributes'), [
    ['Activity logs are append-only: keep both sides on merge', '*.jsonl merge=union'],
    ['Plans merge field by field, so two people editing different things never conflict', '*.json merge=pathways'],
  ])
  ensureLines(path.join(WORKSPACE, '.gitignore'), [['Where you last were stays on this computer', '.local/']])
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
  const meta = await readJson<Partial<Pathway> & Record<string, unknown>>(path.join(dir, 'pathway.json'))
  if (!meta) return null
  const lists = {} as Record<ListKey, Item[]>
  for (const l of LISTS) lists[l.key] = await readList(dir, l, meta[l.key])
  const contextFile = path.join(dir, 'context.md')
  const context = fs.existsSync(contextFile) ? fromMarkdown((await readText(contextFile)) ?? '') : (meta.context ?? '')
  const local = (await readJsonQuiet<{ currentNodeId?: string | null }>(localFile(id))) ?? {}
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
    ...(meta as Partial<Pathway>),
    ...(lists as unknown as Pick<Pathway, ListKey>),
    context,
    currentNodeId: 'currentNodeId' in local ? (local.currentNodeId ?? null) : (meta.currentNodeId ?? null),
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

// The context as Markdown: one line per paragraph, so edits to different paragraphs merge.
const toMarkdown = (s: string) => (s.endsWith('\n') ? s : `${s}\n`)
const fromMarkdown = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s)

async function readText(file: string) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    written.set(file, raw)
    return raw
  } catch {
    return null
  }
}

async function readJsonQuiet<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export async function save(p: Pathway) {
  const dir = dirOf(p.id)
  for (const l of LISTS) await writeList(dir, l, (p[l.key] ?? []) as unknown as Item[])
  const contextFile = path.join(dir, 'context.md')
  if (p.context) await writeIfChanged(contextFile, toMarkdown(p.context))
  else if (fs.existsSync(contextFile)) {
    await fsp.rm(contextFile, { force: true })
    written.delete(contextFile)
  }
  await writeIfChanged(localFile(p.id), stable({ currentNodeId: p.currentNodeId ?? null }))
  // last, so a pathway.json without its lists only appears once they're in their own files
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
  const contextFile = path.join(dir, 'context.md')
  if (fs.existsSync(contextFile) || written.has(contextFile)) files.push(contextFile)
  for (const sub of ['nodes', ...LISTS.map((l) => l.dir)]) {
    const d = path.join(dir, sub)
    if (fs.existsSync(d)) for (const f of await fsp.readdir(d)) if (f.endsWith('.json')) files.push(path.join(d, f))
  }
  for (const f of files) if (await changedOnDisk(f)) return true
  // a file we know about was deleted
  for (const k of written.keys()) if (k.startsWith(dir + path.sep) && !fs.existsSync(k)) return true
  return false
}
