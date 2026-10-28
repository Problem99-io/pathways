import type { Op } from '../shared/ops'
import type { PathwayDoc, PathwaySummary } from '../shared/types'
import type { ChatMessage, ChatSettings, ChatStatus } from '../shared/chat'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`)
  return body as T
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export interface Info {
  user: string
  port: number
  mcpUrl: string
  workspace: string
  root: string
}

export interface GitState {
  status: {
    available: boolean
    repo: boolean
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
  log: { hash: string; author: string; at: string; subject: string }[]
  workspace: string
}

export const api = {
  info: () => call<Info>('/api/info'),
  list: () => call<PathwaySummary[]>('/api/pathways'),
  get: (id: string) => call<PathwayDoc>(`/api/pathways/${id}`),
  create: (body: unknown) => call<PathwayDoc>('/api/pathways', post(body)),
  remove: (id: string) => call<{ ok: true }>(`/api/pathways/${id}`, { method: 'DELETE' }),
  ops: (id: string, ops: Op[], message?: string, actor?: string) =>
    call<PathwayDoc>(`/api/pathways/${id}/ops`, post({ ops, message, actor: actor ? { type: 'user', name: actor } : undefined })),
  upload: (id: string, file: File) =>
    call<{ url: string; name: string }>(`/api/pathways/${id}/assets?name=${encodeURIComponent(file.name || 'pasted.png')}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    }),
  unfurl: (url: string) => call<{ title?: string; description?: string; image?: string }>(`/api/unfurl?url=${encodeURIComponent(url)}`),
  git: () => call<GitState>('/api/git'),
  chatStatus: (fresh = false) => call<ChatStatus>(`/api/chat/status${fresh ? '?fresh=1' : ''}`),
  chatSettings: (s: ChatSettings) => call<ChatStatus>('/api/chat/settings', post(s)),
  chat: (id: string) => call<{ messages: ChatMessage[]; running: boolean }>(`/api/pathways/${id}/chat`),
  chatSend: (id: string, body: { text: string; by: string; context?: { label: string; prompt: string } }) => call<{ ok: true }>(`/api/pathways/${id}/chat`, post(body)),
  chatStop: (id: string) => call<{ ok: true }>(`/api/pathways/${id}/chat/stop`, post({})),
  chatClear: (id: string) => call<{ ok: true }>(`/api/pathways/${id}/chat`, { method: 'DELETE' }),
  gitAction: (action: 'init' | 'remote' | 'commit' | 'pull' | 'push' | 'sync' | 'autosync', body: unknown = {}) =>
    call<GitState>(`/api/git/${action}`, post(body)),
}

type Listener = (type: string, data: unknown) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null

export function subscribe(fn: Listener) {
  listeners.add(fn)
  if (!source) {
    source = new EventSource('/api/events')
    for (const t of ['pathway', 'deleted', 'external', 'chat', 'chat.delta', 'chat.reset', 'chat.running']) {
      source.addEventListener(t, (e) => {
        const data = JSON.parse((e as MessageEvent).data)
        for (const l of listeners) l(t, data)
      })
    }
  }
  return () => {
    listeners.delete(fn)
  }
}
