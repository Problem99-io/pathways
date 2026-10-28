// Git as the shared source of truth. Everything runs locally against the
// workspace folder using the user's own git install and credentials.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE } from './storage'

export interface GitStatus {
  available: boolean
  repo: boolean
  /** The workspace sits inside a bigger repo (e.g. a plans/ folder in a company repo). */
  nested: boolean
  root?: string
  branch?: string
  remote?: string
  upstream?: string
  ahead: number
  behind: number
  dirty: number
  autoSync: boolean
  lastSync?: string
  lastError?: string
  user?: string
  busy: boolean
  conflict?: boolean
}

interface Run {
  code: number
  out: string
  err: string
}

function git(args: string[], cwd = WORKSPACE): Promise<Run> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 8 << 20 }, (e, out, err) => {
      const code = e ? (typeof (e as { code?: unknown }).code === 'number' ? ((e as { code: number }).code) : 1) : 0
      resolve({ code, out: String(out).trim(), err: String(err).trim() })
    })
  })
}

async function must(args: string[]) {
  const r = await git(args)
  if (r.code !== 0) throw new Error(r.err || r.out || `git ${args[0]} failed`)
  return r.out
}

let busy = false
let lastSync: string | undefined
let lastError: string | undefined
let conflict = false
let autoSync = false
let timer: NodeJS.Timeout | null = null
let pending: string[] = [] // change summaries since the last commit
let lastLocalChange = 0
let onPulled: (() => Promise<void>) | null = null

export function onRemoteChanges(fn: () => Promise<void>) {
  onPulled = fn
}

export function noteChange(summary: string) {
  pending.push(summary)
  lastLocalChange = Date.now()
}

async function info() {
  const v = await git(['--version'])
  if (v.code !== 0) return { available: false as const }
  const top = await git(['rev-parse', '--show-toplevel'])
  if (top.code !== 0) return { available: true as const, repo: false }
  const ignored = await git(['check-ignore', '-q', '.'])
  if (ignored.code === 0) return { available: true as const, repo: false }
  const root = fs.realpathSync(top.out)
  return { available: true as const, repo: true, root, nested: root !== fs.realpathSync(WORKSPACE) }
}

async function autoSyncFile() {
  const r = await git(['rev-parse', '--absolute-git-dir'])
  return r.code === 0 ? path.join(r.out, 'pathways-autosync') : null
}

export async function userName() {
  const r = await git(['config', 'user.name'])
  return r.code === 0 && r.out ? r.out : process.env.USER || 'You'
}

export async function status(): Promise<GitStatus> {
  const base: GitStatus = { available: false, repo: false, nested: false, ahead: 0, behind: 0, dirty: 0, autoSync, busy, lastSync, lastError, conflict }
  const i = await info()
  if (!i.available) return base
  base.available = true
  base.user = await userName()
  if (!i.repo) return base
  Object.assign(base, { repo: true, root: i.root, nested: i.nested })
  const s = await git(['status', '--porcelain=v1', '--branch', '--', '.'])
  const lines = s.out.split('\n').filter(Boolean)
  const head = lines.find((l) => l.startsWith('## '))
  if (head) {
    const m = head.slice(3).match(/^(?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/)
    if (m) {
      base.branch = m[1]
      base.upstream = m[2]
      const a = m[3]?.match(/ahead (\d+)/)
      const b = m[3]?.match(/behind (\d+)/)
      base.ahead = a ? Number(a[1]) : 0
      base.behind = b ? Number(b[1]) : 0
    }
  }
  base.dirty = lines.filter((l) => !l.startsWith('## ')).length
  const remote = await git(['remote', 'get-url', 'origin'])
  if (remote.code === 0) base.remote = remote.out
  return base
}

export async function log(limit = 15) {
  const r = await git(['log', `-n${limit}`, '--pretty=format:%h%x1f%an%x1f%aI%x1f%s', '--', '.'])
  if (r.code !== 0 || !r.out) return []
  return r.out.split('\n').map((l) => {
    const [hash, author, at, subject] = l.split('\x1f')
    return { hash, author, at, subject }
  })
}

async function locked<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('A git operation is already running')
  busy = true
  try {
    const out = await fn()
    lastError = undefined
    return out
  } catch (e) {
    lastError = (e as Error).message
    throw e
  } finally {
    busy = false
  }
}

export function init(remoteUrl?: string) {
  return locked(async () => {
    const i = await info()
    if (!i.repo) await must(['init', '-b', 'main'])
    if (remoteUrl) {
      const has = await git(['remote', 'get-url', 'origin'])
      await must(has.code === 0 ? ['remote', 'set-url', 'origin', remoteUrl] : ['remote', 'add', 'origin', remoteUrl])
    }
    await commitInner('Pathways: initial commit')
    return status()
  })
}

export function setRemote(url: string) {
  return locked(async () => {
    const has = await git(['remote', 'get-url', 'origin'])
    await must(has.code === 0 ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
    return status()
  })
}

function autoMessage() {
  const uniq = [...new Set(pending)]
  if (!uniq.length) return 'Pathways: update plans'
  const head = uniq.length === 1 ? uniq[0] : `${uniq.length} changes`
  return `Pathways: ${head}`.slice(0, 120) + (uniq.length > 1 ? '\n\n' + uniq.slice(-30).map((x) => `- ${x}`).join('\n') : '')
}

async function commitInner(message?: string) {
  await must(['add', '-A', '--', '.'])
  const staged = await git(['diff', '--cached', '--quiet', '--', '.'])
  if (staged.code === 0) return false
  await must(['commit', '-m', message || autoMessage(), '--', '.'])
  pending = []
  return true
}

export function commit(message?: string) {
  return locked(() => commitInner(message))
}

async function pullInner(strategy?: 'mine' | 'theirs') {
  const s = await status()
  if (!s.remote) return false
  const fetch = await git(['fetch', 'origin'])
  if (fetch.code !== 0) throw new Error(fetch.err || 'git fetch failed')
  const s2 = await status()
  if (!s2.upstream) {
    // first sync against a remote: track origin/<branch> if it exists
    const has = await git(['rev-parse', '--verify', `origin/${s2.branch}`])
    if (has.code !== 0) return false
    await git(['branch', `--set-upstream-to=origin/${s2.branch}`])
  }
  const args = strategy
    ? ['pull', '--no-rebase', '--no-edit', '-X', strategy === 'mine' ? 'ours' : 'theirs']
    : ['pull', '--rebase', '--autostash']
  const r = await git(args)
  if (r.code !== 0) {
    await git(['rebase', '--abort'])
    await git(['merge', '--abort'])
    conflict = /conflict/i.test(r.out + r.err)
    throw new Error(conflict ? 'Your changes and the remote changes touch the same lines. Choose whose version to keep.' : r.err || 'git pull failed')
  }
  conflict = false
  if (onPulled) await onPulled()
  return true
}

export function pull(strategy?: 'mine' | 'theirs') {
  return locked(() => pullInner(strategy))
}

async function pushInner() {
  const s = await status()
  if (!s.remote) return false
  const r = s.upstream ? await git(['push']) : await git(['push', '-u', 'origin', 'HEAD'])
  if (r.code !== 0) throw new Error(r.err || 'git push failed')
  return true
}

export function push() {
  return locked(pushInner)
}

/** Commit local changes, pull others' changes, push ours. */
export function sync(opts: { message?: string; strategy?: 'mine' | 'theirs' } = {}) {
  return locked(async () => {
    const i = await info()
    if (!i.repo) throw new Error('This workspace is not a git repository yet')
    await commitInner(opts.message)
    await pullInner(opts.strategy)
    await pushInner()
    lastSync = new Date().toISOString()
    return status()
  })
}

export async function setAutoSync(on: boolean) {
  autoSync = on
  const f = await autoSyncFile()
  if (f) {
    if (on) fs.writeFileSync(f, 'on\n')
    else fs.rmSync(f, { force: true })
  }
  schedule()
}

export async function restoreAutoSync() {
  const f = await autoSyncFile()
  autoSync = !!f && fs.existsSync(f)
  schedule()
}

function schedule() {
  if (timer) clearInterval(timer)
  timer = null
  if (!autoSync) return
  timer = setInterval(async () => {
    if (busy) return
    try {
      const s = await status()
      if (!s.repo || !s.remote) return
      // let a burst of edits settle before committing
      if (Date.now() - lastLocalChange < 15_000) return
      await sync()
    } catch {
      /* surfaced through status().lastError */
    }
  }, 45_000)
}
