// Pathways local server: REST + live events for the web app, git sync,
// asset uploads, and an MCP endpoint (Streamable HTTP) for AI clients.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { applyOps, describeOps, newPathway, OpError, prepareOp, uid, type Op } from '../shared/ops'
import type { Actor, ActivityEntry, Pathway, PathwayDoc, PathwaySummary } from '../shared/types'
import * as store from './storage'
import * as git from './git'
import { buildMcpServer, httpApi } from '../mcp/tools'
import * as chat from './chat'

const PORT = Number(process.env.PATHWAYS_PORT || 4317)
const BASE = `http://localhost:${PORT}`

interface Entry {
  pathway: Pathway
  activity: ActivityEntry[]
  rev: number
  updatedAt: string
}
const docs = new Map<string, Entry>()
let revCounter = Date.now()

const toDoc = (e: Entry): PathwayDoc => ({ ...e.pathway, rev: e.rev, activity: e.activity.slice(-100) })

// ---------- live events ----------

const clients = new Set<Response>()
function broadcast(type: string, payload: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const c of clients) c.write(msg)
}

// ---------- loading ----------

async function loadAll() {
  for (const id of await store.listIds()) await reload(id, false)
}

async function reload(id: string, announce = true) {
  const loaded = await store.load(id)
  if (!loaded) {
    if (docs.delete(id) && announce) broadcast('deleted', { id })
    return
  }
  const prev = docs.get(id)
  const entry: Entry = { ...loaded, rev: ++revCounter, updatedAt: new Date().toISOString() }
  docs.set(id, entry)
  if (announce && (!prev || JSON.stringify(prev.pathway) !== JSON.stringify(entry.pathway) || prev.activity.length !== entry.activity.length)) {
    broadcast('pathway', toDoc(entry))
    broadcast('external', { id })
  }
}

// Serialize writes per pathway so saves never interleave.
const queues = new Map<string, Promise<unknown>>()
let saving = 0
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(async () => {
    saving++
    try {
      return await fn()
    } finally {
      saving--
    }
  })
  queues.set(id, next)
  return next
}

async function apply(id: string, ops: Op[], actor: Actor, message?: string) {
  return serial(id, async () => {
    const e = docs.get(id)
    if (!e) throw new HttpError(404, 'Pathway not found')
    const prepared = ops.map((op) => prepareOp(op, e.pathway))
    const next = applyOps(e.pathway, prepared)
    const summary = message || describeOps(e.pathway, prepared)
    const entry: ActivityEntry = { id: uid(), at: new Date().toISOString(), actor, message: summary }
    await store.save(next)
    await store.appendActivity(id, entry)
    e.pathway = next
    e.activity.push(entry)
    e.rev = ++revCounter
    e.updatedAt = entry.at
    git.noteChange(`${actor.type === 'ai' ? `${actor.name}: ` : ''}${summary}`)
    broadcast('pathway', toDoc(e))
    return toDoc(e)
  })
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

let userName = 'You'
const resolveActor = (a?: Partial<Actor>): Actor => ({
  type: a?.type === 'ai' ? 'ai' : 'user',
  name: a?.name || (a?.type === 'ai' ? 'AI' : userName),
})

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'pathway'
  )
}

// ---------- app ----------

const app = express()
app.use(cors())

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res)
      if (out !== undefined && !res.headersSent) res.json(out)
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof OpError ? 400 : 500
      if (status === 500) console.error(e)
      if (!res.headersSent) res.status(status).json({ error: (e as Error).message })
    }
  }

// MCP over Streamable HTTP, stateless: a fresh server per request.
app.post('/mcp', express.json({ limit: '25mb' }), async (req, res) => {
  const ua = String(req.headers['user-agent'] || '')
  const client = /claude/i.test(ua) ? 'Claude' : /cursor/i.test(ua) ? 'Cursor' : /openai|codex|chatgpt/i.test(ua) ? 'ChatGPT' : undefined
  const server = buildMcpServer(httpApi(BASE), () => (req.headers['x-pathways-actor'] as string) || client)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.error('MCP error', e)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
  }
})
app.get('/mcp', (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }))
app.delete('/mcp', (_req, res) => res.status(405).end())

// Raw uploads (images/files) go straight into the pathway's assets folder.
app.post(
  '/api/pathways/:id/assets',
  express.raw({ type: () => true, limit: '40mb' }),
  h(async (req) => {
    const id = String(req.params.id)
    if (!docs.has(id)) throw new HttpError(404, 'Pathway not found')
    const original = path.basename(String(req.query.name || 'file')).replace(/[^\w.\-]+/g, '_')
    const ext = path.extname(original)
    const name = `${path.basename(original, ext).slice(0, 40)}-${uid(5)}${ext}`
    const dir = store.assetsDir(id)
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, name), req.body as Buffer)
    git.noteChange(`uploaded ${original}`)
    return { url: `/files/${id}/assets/${name}`, name }
  }),
)

app.use(express.json({ limit: '10mb' }))

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.write(`event: hello\ndata: {}\n\n`)
  clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
  })
})

app.get(
  '/api/pathways',
  h(async () => {
    const out: PathwaySummary[] = [...docs.values()]
      .map(({ pathway: p, updatedAt, activity }) => ({
        id: p.id,
        title: p.title,
        goals: p.goals.map((g) => g.title),
        current: p.current.title,
        paths: p.paths.filter((x) => x.status !== 'archived').length,
        steps: p.nodes.length,
        done: p.nodes.filter((n) => n.status === 'done').length,
        people: p.people,
        colors: p.paths.map((x) => x.color),
        updatedAt: activity.at(-1)?.at ?? updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return out
  }),
)

app.post(
  '/api/pathways',
  h(async (req) => {
    const b = req.body ?? {}
    const goals = Array.isArray(b.goals) ? b.goals : b.goal ? [b.goal] : []
    if (!b.title || !b.current?.title || !goals.length || !goals[0]?.title) {
      throw new HttpError(400, 'title, current.title and at least one goal are required')
    }
    let id = slug(b.title)
    if (docs.has(id) || fs.existsSync(path.join(store.WORKSPACE, id))) id = `${id}-${uid(4).toLowerCase()}`
    const p = newPathway({ id, title: b.title, current: b.current, goals, context: b.context, startDate: b.startDate })
    const actor = resolveActor(b.actor)
    const entry: ActivityEntry = { id: uid(), at: new Date().toISOString(), actor, message: `created pathway "${p.title}"` }
    await serial(id, async () => {
      await store.save(p)
      await store.appendActivity(id, entry)
    })
    const e: Entry = { pathway: p, activity: [entry], rev: ++revCounter, updatedAt: entry.at }
    docs.set(id, e)
    git.noteChange(entry.message)
    broadcast('pathway', toDoc(e))
    return toDoc(e)
  }),
)

app.get(
  '/api/pathways/:id',
  h(async (req) => {
    const e = docs.get(String(req.params.id))
    if (!e) throw new HttpError(404, 'Pathway not found')
    return toDoc(e)
  }),
)

app.delete(
  '/api/pathways/:id',
  h(async (req) => {
    const id = String(req.params.id)
    await serial(id, () => store.remove(id))
    docs.delete(id)
    git.noteChange(`deleted pathway ${id}`)
    broadcast('deleted', { id })
    return { ok: true }
  }),
)

app.post(
  '/api/pathways/:id/ops',
  h(async (req) => {
    const { ops, actor, message } = req.body ?? {}
    if (!Array.isArray(ops) || !ops.length) throw new HttpError(400, 'ops must be a non-empty array')
    return apply(String(req.params.id), ops, resolveActor(actor), message)
  }),
)

// Link previews for references.
app.get(
  '/api/unfurl',
  h(async (req) => {
    const url = String(req.query.url || '')
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'http(s) url required')
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'user-agent': 'Mozilla/5.0 (Pathways link preview)', accept: 'text/html' },
        redirect: 'follow',
      })
      const html = (await r.text()).slice(0, 400_000)
      const meta = (k: string) =>
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ??
        html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'))?.[1]
      const title = meta('og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
      let image = meta('og:image') ?? meta('twitter:image')
      if (image) image = new URL(image, r.url).toString()
      return { title: decode(title?.trim()), description: decode(meta('og:description') ?? meta('description')), image }
    } catch {
      return { title: new URL(url).hostname }
    }
  }),
)

function decode(s?: string) {
  return s
    ?.replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// ---------- git ----------

app.get(
  '/api/git',
  h(async () => ({ status: await git.status(), log: await git.log(), workspace: store.WORKSPACE })),
)
const gitAction = (fn: (body: Record<string, unknown>) => Promise<unknown>) =>
  h(async (req) => {
    try {
      await fn(req.body ?? {})
    } catch (e) {
      const s = await git.status()
      throw new HttpError(409, (e as Error).message + (s.conflict ? '' : ''))
    }
    return { status: await git.status(), log: await git.log(), workspace: store.WORKSPACE }
  })
app.post('/api/git/init', gitAction((b) => git.init((b.remote as string) || undefined)))
app.post('/api/git/remote', gitAction((b) => git.setRemote(String(b.remote))))
app.post('/api/git/commit', gitAction((b) => git.commit(b.message as string)))
app.post('/api/git/pull', gitAction((b) => git.pull(b.strategy as 'mine' | 'theirs' | undefined)))
app.post('/api/git/push', gitAction(() => git.push()))
app.post(
  '/api/git/sync',
  gitAction((b) => git.sync({ message: b.message as string, strategy: b.strategy as 'mine' | 'theirs' | undefined })),
)
app.post('/api/git/autosync', gitAction((b) => git.setAutoSync(!!b.on)))

// ---------- chat with Claude ----------

const chatErr = (e: unknown) => {
  const status = (e as { status?: number }).status
  return status ? new HttpError(status, (e as Error).message) : e
}
app.get('/api/chat/status', h(async (req) => chat.status(req.query.fresh === '1')))
app.post(
  '/api/chat/settings',
  h(async (req) => {
    const b = req.body ?? {}
    await chat.writeSettings({ claudePath: b.claudePath, model: b.model })
    return chat.status(true)
  }),
)
app.get('/api/pathways/:id/chat', h(async (req) => chat.history(String(req.params.id))))
app.post(
  '/api/pathways/:id/chat',
  h(async (req) => {
    const e = docs.get(String(req.params.id))
    if (!e) throw new HttpError(404, 'Pathway not found')
    const { text, by, context } = req.body ?? {}
    if (!text || typeof text !== 'string') throw new HttpError(400, 'Say something first')
    try {
      await chat.send({ pathway: { id: e.pathway.id, title: e.pathway.title }, text, by: by || userName, context })
    } catch (err) {
      throw chatErr(err)
    }
    return { ok: true }
  }),
)
app.post('/api/pathways/:id/chat/stop', h(async (req) => (chat.stop(String(req.params.id)), { ok: true })))
app.delete('/api/pathways/:id/chat', h(async (req) => (await chat.clear(String(req.params.id)), { ok: true })))

app.get('/api/info', (_req, res) => res.json({ user: userName, port: PORT, mcpUrl: `${BASE}/mcp`, workspace: store.WORKSPACE, root: process.cwd() }))

// ---------- static ----------

app.use('/files', express.static(store.WORKSPACE, { dotfiles: 'deny', fallthrough: false }))
const dist = path.join(process.cwd(), 'dist')
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()))
}

// ---------- boot ----------

async function main() {
  store.ensureWorkspace()
  chat.initChat({ emit: broadcast, mcpUrl: `${BASE}/mcp` })
  await loadAll()
  userName = await git.userName()
  git.onRemoteChanges(async () => {
    const ids = new Set([...docs.keys(), ...(await store.listIds())])
    for (const id of ids) await reload(id)
  })
  await git.restoreAutoSync()

  // Pick up edits made outside the app (git pull from a terminal, an editor, another tool).
  let t: NodeJS.Timeout | null = null
  const check = async () => {
    if (saving) {
      t = setTimeout(check, 300)
      return
    }
    const ids = new Set([...docs.keys(), ...(await store.listIds())])
    for (const id of ids) {
      if (!docs.has(id) || (await store.externallyChanged(id))) await reload(id)
    }
  }
  try {
    fs.watch(store.WORKSPACE, { recursive: true }, (_ev, file) => {
      if (!file || file.startsWith('.git') || file.endsWith('.tmp') || file.includes('/assets/')) return
      if (t) clearTimeout(t)
      t = setTimeout(check, 400)
    })
  } catch {
    console.warn('File watching unavailable; external changes need a restart')
  }

  app.listen(PORT, () => {
    console.log(`\n  ◆ Pathways server  ${BASE}`)
    console.log(`    workspace       ${store.WORKSPACE}`)
    console.log(`    MCP (http)      ${BASE}/mcp\n`)
  })
}

main()
