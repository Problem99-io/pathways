// Chat with Claude from inside the app. Each message runs Claude Code
// headless (`claude -p`, streaming JSON) with this server's MCP endpoint and
// the planning skill, resuming the same conversation per pathway. Replies
// stream to the browser over the app's event stream; history is kept in
// WORKSPACE/.chat/ (git-ignored, so it stays on this computer).

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { promisify } from 'node:util'
import { nanoid } from 'nanoid'
import { WORKSPACE } from './storage'
import type { ChatMessage, ChatSettings, ChatStatus } from '../shared/chat'
export type { ChatMessage, ChatSettings, ChatStatus, ChatTool } from '../shared/chat'

const run = promisify(execFile)

interface ChatLog {
  sessionId?: string
  messages: ChatMessage[]
}

const DIR = path.join(WORKSPACE, '.chat')
const SETTINGS = path.join(DIR, 'settings.json')
const SKILL = path.join(process.cwd(), '.claude', 'skills', 'pathways', 'SKILL.md')

type Emit = (type: string, payload: unknown) => void
let emit: Emit = () => {}
let mcpUrl = 'http://localhost:4317/mcp'

export function initChat(opts: { emit: Emit; mcpUrl: string }) {
  emit = opts.emit
  mcpUrl = opts.mcpUrl
  fs.mkdirSync(DIR, { recursive: true })
  // keep chats out of the team's git history
  const ignore = path.join(WORKSPACE, '.gitignore')
  const cur = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : ''
  if (!cur.split('\n').includes('.chat/')) fs.writeFileSync(ignore, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# Chats with Claude stay on this computer\n.chat/\n`)
}

// ---------- settings & finding the CLI ----------

export function readSettings(): ChatSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  } catch {
    return {}
  }
}
export async function writeSettings(patch: ChatSettings) {
  const next = { ...readSettings(), ...patch }
  for (const k of Object.keys(next) as (keyof ChatSettings)[]) if (!next[k]) delete next[k]
  await fsp.writeFile(SETTINGS, JSON.stringify(next, null, 2))
  statusCache = null
}

/** Where `claude` lives: settings → PATHWAYS_CLAUDE → PATH and the usual install spots → the copy bundled with the desktop app. */
function candidates(): string[] {
  const home = os.homedir()
  const out: string[] = []
  const s = readSettings().claudePath
  if (s) out.push(s)
  if (process.env.PATHWAYS_CLAUDE) out.push(process.env.PATHWAYS_CLAUDE)
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir) out.push(path.join(dir, 'claude'))
  out.push(path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude')
  const bundled = path.join(home, 'Library/Application Support/Claude/claude-code')
  try {
    const versions = fs.readdirSync(bundled).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const v of versions)
      for (const h of fs.readdirSync(path.join(bundled, v))) out.push(path.join(bundled, v, h, 'claude.app/Contents/MacOS/claude'))
  } catch {
    /* not on a Mac with the desktop app */
  }
  return out
}
const findClaude = () => candidates().find((p) => {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
})

/** The CLI runs as itself, not as part of whatever Claude session started this server. */
function cleanEnv() {
  const env = { ...process.env }
  const nested = !!env.CLAUDECODE
  for (const k of Object.keys(env)) if (/^(CLAUDE_|CLAUDECODE$|AI_AGENT$|BAGGAGE$)/.test(k)) delete env[k]
  if (nested) delete env.ANTHROPIC_BASE_URL
  return env
}

let statusCache: { at: number; status: ChatStatus } | null = null
export async function status(fresh = false): Promise<ChatStatus> {
  if (!fresh && statusCache && Date.now() - statusCache.at < 30_000) return statusCache.status
  const bin = findClaude()
  const model = readSettings().model
  let st: ChatStatus
  if (!bin) st = { available: false, loggedIn: false, model }
  else {
    try {
      const env = cleanEnv()
      const [v, a] = await Promise.all([
        run(bin, ['--version'], { env, timeout: 15_000 }),
        run(bin, ['auth', 'status', '--json'], { env, timeout: 15_000 }).catch((e) => ({ stdout: (e as { stdout?: string }).stdout ?? '{}' })),
      ])
      const auth = JSON.parse(a.stdout || '{}') as { loggedIn?: boolean; authMethod?: string }
      st = { available: true, path: bin, version: v.stdout.trim().split(' ')[0], loggedIn: !!auth.loggedIn || !!process.env.ANTHROPIC_API_KEY, authMethod: auth.authMethod, model }
    } catch (e) {
      st = { available: false, path: bin, loggedIn: false, error: (e as Error).message, model }
    }
  }
  statusCache = { at: Date.now(), status: st }
  return st
}

// ---------- history ----------

const logs = new Map<string, ChatLog>()
const running = new Map<string, ChildProcess>()
const stopping = new Set<string>()
const INTERRUPTED = 'Interrupted — Pathways restarted while Claude was answering. Retry to pick up where it left off.'
const fileOf = (id: string) => path.join(DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)

async function load(id: string): Promise<ChatLog> {
  let log = logs.get(id)
  if (log) return log
  try {
    log = JSON.parse(await fsp.readFile(fileOf(id), 'utf8')) as ChatLog
    // a run that died with the server is over
    for (const m of log.messages) if (m.pending) Object.assign(m, { pending: false, stopped: true, error: INTERRUPTED })
  } catch {
    log = { messages: [] }
  }
  logs.set(id, log)
  return log
}
async function save(id: string) {
  const log = logs.get(id)
  if (log) await fsp.writeFile(fileOf(id), JSON.stringify(log, null, 1))
}

export async function history(id: string) {
  const log = await load(id)
  return { messages: log.messages, running: running.has(id) }
}

export async function clear(id: string) {
  stop(id)
  logs.set(id, { messages: [] })
  await save(id)
  emit('chat.reset', { pathwayId: id })
}

export function stop(id: string) {
  const p = running.get(id)
  if (p) {
    stopping.add(id)
    p.kill('SIGTERM')
  }
}

// ---------- talking to Claude ----------

function systemPrompt(pathway: { id: string; title: string }) {
  let skill = ''
  try {
    skill = fs.readFileSync(SKILL, 'utf8').replace(/^---[\s\S]*?---\s*/, '')
  } catch {
    /* skill missing: the MCP server's own instructions still apply */
  }
  return `You are Claude, chatting with the user in a side panel inside the Pathways app.
They are looking at the pathway "${pathway.title}" (pathwayId "${pathway.id}") right now.
You read and change the plan only through the pathways MCP tools; every change animates live on their screen, so do the work rather than describing it.
Always pass pathwayId "${pathway.id}". Read current state first (get_pathway, or get_forward for "what's next") instead of assuming.
Reply like a sharp co-founder in chat: short, plain, a few sentences or a tight list. Say what you changed. When a request is vague, make a sensible first pass and offer to adjust rather than asking a string of questions.
Use WebSearch and WebFetch for research, and attach what you find with add_reference.

${skill}`
}

const short = (s: unknown, n = 48) => {
  const t = String(s ?? '').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** A human line for a tool call, e.g. "Added 4 steps". */
function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const n = name.replace(/^mcp__pathways__/, '')
  const steps = Array.isArray(input.steps) ? input.steps.length : 0
  switch (n) {
    case 'get_pathway':
      return 'Read the pathway'
    case 'list_pathways':
      return 'Listed pathways'
    case 'get_forward':
      return 'Checked what’s next'
    case 'compare_paths':
      return 'Compared paths'
    case 'create_path':
      return `Created path “${short(input.name)}”${steps ? ` · ${steps} steps` : ''}`
    case 'add_steps':
      return `Added ${steps || 'some'} step${steps === 1 ? '' : 's'}`
    case 'update_step':
      return `Updated a step${input.title ? ` → “${short(input.title)}”` : ''}`
    case 'delete_step':
      return 'Removed a step'
    case 'complete_step':
      return 'Completed a step'
    case 'connect_steps':
      return 'Connected steps'
    case 'set_current_step':
      return 'Moved “you are here”'
    case 'update_path':
      return `Updated path${input.name ? ` “${short(input.name)}”` : ''}`
    case 'fork_path':
      return `Forked “${short(input.name)}”`
    case 'delete_path':
      return 'Deleted a path'
    case 'set_goal':
      return `Set goal “${short(input.title)}”`
    case 'log_cycle':
      return 'Logged a cycle'
    case 'assign_people':
      return 'Assigned people'
    case 'add_reference':
      return `Attached ${short(input.title ?? input.url ?? 'a reference')}`
    case 'record_signal':
      return 'Noted a change'
    case 'branch_step': {
      const k = Array.isArray(input.outcomes) ? input.outcomes.length : 0
      return `Mapped ${k || 'the'} possible futures`
    }
    case 'settle_branch':
      return input.outcome === null ? 'Un-settled a fork' : `Settled a fork → “${short(input.outcome)}”`
    case 'resolve_request':
      return 'Resolved a request'
    case 'update_pathway':
      return 'Updated the pathway'
    case 'create_pathway':
      return `Created pathway “${short(input.title)}”`
    case 'WebSearch':
      return `Searched “${short(input.query)}”`
    case 'WebFetch':
      try {
        return `Read ${new URL(String(input.url)).hostname}`
      } catch {
        return 'Read a page'
      }
    default:
      return n.replace(/_/g, ' ')
  }
}

export async function send(opts: { pathway: { id: string; title: string }; text: string; by: string; context?: { label: string; prompt: string } }) {
  const { pathway } = opts
  const id = pathway.id
  if (running.has(id)) throw Object.assign(new Error('Claude is still answering — stop it or wait'), { status: 409 })
  const st = await status()
  if (!st.available || !st.path) throw Object.assign(new Error('Claude Code isn’t installed on this computer'), { status: 412 })

  const log = await load(id)
  const user: ChatMessage = { id: nanoid(10), role: 'user', text: opts.text, at: new Date().toISOString(), by: opts.by, context: opts.context?.label }
  const reply: ChatMessage = { id: nanoid(10), role: 'assistant', text: '', at: new Date().toISOString(), tools: [], pending: true }
  log.messages.push(user, reply)
  await save(id)
  emit('chat', { pathwayId: id, message: user })
  emit('chat', { pathwayId: id, message: reply })

  const mcp = { mcpServers: { pathways: { type: 'http', url: mcpUrl, headers: { 'x-pathways-actor': 'Claude' } } } }
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', JSON.stringify(mcp),
    '--strict-mcp-config',
    '--append-system-prompt', systemPrompt(pathway),
    '--allowedTools', 'mcp__pathways', 'WebSearch', 'WebFetch',
    '--tools', 'WebSearch', 'WebFetch',
  ]
  const model = readSettings().model
  if (model) args.push('--model', model)
  if (log.sessionId) args.push('--resume', log.sessionId)

  const child = spawn(st.path, args, { cwd: DIR, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  running.set(id, child)
  emit('chat.running', { pathwayId: id, running: true })
  // the prompt goes in on stdin so nothing in it can be read as a flag
  child.stdin.end(opts.context ? `${opts.context.prompt}\n\n${opts.text}` : opts.text)

  const update = () => emit('chat', { pathwayId: id, message: reply })
  const delta = (text: string) => {
    reply.text += text
    emit('chat.delta', { pathwayId: id, id: reply.id, text })
  }
  let streamed = false // got text through partial deltas for the current message
  let finished = false
  let stderr = ''
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))

  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    let ev: Record<string, any>
    try {
      ev = JSON.parse(line)
    } catch {
      return
    }
    if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
      log.sessionId = ev.session_id
    } else if (ev.type === 'stream_event') {
      const e = ev.event ?? {}
      if (e.type === 'message_start') streamed = false
      else if (e.type === 'content_block_start') {
        // separate the text that comes after a tool call
        if (e.content_block?.type === 'text' && reply.text && !reply.text.endsWith('\n\n')) delta('\n\n')
        if (e.content_block?.type === 'tool_use') {
          reply.tools!.push({ id: e.content_block.id, name: e.content_block.name, summary: describeTool(e.content_block.name), state: 'running' })
          update()
        }
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        streamed = true
        delta(e.delta.text)
      }
    } else if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_use') {
          const t = reply.tools!.find((x) => x.id === b.id)
          const summary = describeTool(b.name, b.input)
          if (t) t.summary = summary
          else reply.tools!.push({ id: b.id, name: b.name, summary, state: 'running' })
        } else if (b.type === 'text' && !streamed && b.text) {
          // no partial deltas (older CLI): take the whole block
          if (reply.text && !reply.text.endsWith('\n\n')) delta('\n\n')
          delta(b.text)
        }
      }
      update()
    } else if (ev.type === 'user') {
      for (const b of ev.message?.content ?? []) {
        if (b.type !== 'tool_result') continue
        const t = reply.tools!.find((x) => x.id === b.tool_use_id)
        if (t) t.state = b.is_error ? 'error' : 'ok'
      }
      update()
      void save(id)
    } else if (ev.type === 'result') {
      finished = true
      reply.pending = false
      reply.costUsd = ev.total_cost_usd
      reply.ms = ev.duration_ms
      if (ev.is_error) reply.error = String(ev.result || ev.subtype || 'Claude ran into an error')
      else if (!reply.text && ev.result) reply.text = String(ev.result)
      if (ev.session_id) log.sessionId = ev.session_id
      for (const t of reply.tools!) if (t.state === 'running') t.state = 'ok'
      update()
    }
  })

  child.on('close', (code, signal) => {
    running.delete(id)
    const byUser = stopping.delete(id)
    if (!finished) {
      reply.pending = false
      // 130/143 = interrupted (Ctrl-C / SIGTERM): you pressed Stop, or the app was restarting
      if (signal || code === 130 || code === 143) Object.assign(reply, { stopped: true, error: byUser ? undefined : INTERRUPTED })
      else reply.error = stderr.trim().split('\n').slice(-3).join('\n') || `Claude exited (${code})`
      for (const t of reply.tools!) if (t.state === 'running') t.state = signal ? 'error' : 'ok'
    }
    // a conversation that can't be resumed starts over next time
    if (reply.error && /no conversation found|session/i.test(reply.error)) delete log.sessionId
    update()
    emit('chat.running', { pathwayId: id, running: false })
    void save(id)
  })
  child.on('error', (e) => {
    reply.error = e.message
    reply.pending = false
  })
}
