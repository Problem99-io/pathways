// The in-app chat with Claude: history per pathway, kept live from the
// server's event stream (replies stream in token by token).

import { create } from 'zustand'
import type { ChatMessage, ChatStatus } from '../shared/chat'
import { api, subscribe } from './api'
import { myName, useStore } from './store'

interface Thread {
  messages: ChatMessage[]
  running: boolean
}

interface ChatState {
  status: ChatStatus | null
  threads: Record<string, Thread>
  /** Text waiting in the composer (e.g. from a right-click "Ask Claude"). */
  draft: string
  tab: 'chat' | 'connect'
  setTab(t: 'chat' | 'connect'): void
  loadStatus(fresh?: boolean): Promise<void>
  load(id: string): Promise<void>
  send(id: string, text: string, context?: { label: string; prompt: string }): Promise<void>
  stop(id: string): void
  clear(id: string): Promise<void>
  setDraft(t: string): void
}

const empty: Thread = { messages: [], running: false }

export const useChat = create<ChatState>((set, get) => ({
  status: null,
  threads: {},
  draft: '',
  tab: 'chat',
  setTab(tab) {
    set({ tab })
  },
  async loadStatus(fresh) {
    const status = await api.chatStatus(fresh).catch(() => null)
    set({ status })
  },
  async load(id) {
    const t = await api.chat(id).catch(() => null)
    if (t) set({ threads: { ...get().threads, [id]: t } })
  },
  async send(id, text, context) {
    try {
      await api.chatSend(id, { text, by: myName(), context })
    } catch (e) {
      useStore.getState().toast({ text: (e as Error).message, tone: 'error' })
      throw e
    }
  },
  stop(id) {
    void api.chatStop(id)
  },
  async clear(id) {
    await api.chatClear(id)
  },
  setDraft(draft) {
    set({ draft })
  },
}))

export const useThread = (id: string) => useChat((s) => s.threads[id] ?? empty)
export const chatReady = (s: ChatStatus | null) => !!s?.available && s.loggedIn

/** Open the chat and ask Claude something — or leave it in the composer if Claude isn't set up yet. */
export function askClaude(text: string, context?: { label: string; prompt: string }) {
  const s = useStore.getState()
  const c = useChat.getState()
  if (s.side !== 'ai') s.setSide('ai')
  c.setTab('chat')
  if (!s.doc || !text) return
  if (chatReady(c.status) && !c.threads[s.doc.id]?.running) void c.send(s.doc.id, text, context).catch(() => c.setDraft(text))
  else c.setDraft(text)
}

const patch = (id: string, fn: (t: Thread) => Thread) => {
  const threads = useChat.getState().threads
  useChat.setState({ threads: { ...threads, [id]: fn(threads[id] ?? empty) } })
}

subscribe((type, data) => {
  const d = data as { pathwayId: string; message?: ChatMessage; id?: string; text?: string; running?: boolean }
  if (type === 'chat' && d.message) {
    const m = d.message
    patch(d.pathwayId, (t) => {
      const i = t.messages.findIndex((x) => x.id === m.id)
      const messages = i === -1 ? [...t.messages, m] : t.messages.map((x, j) => (j === i ? m : x))
      return { ...t, messages }
    })
  } else if (type === 'chat.delta' && d.id) {
    patch(d.pathwayId, (t) => ({ ...t, messages: t.messages.map((x) => (x.id === d.id ? { ...x, text: x.text + (d.text ?? '') } : x)) }))
  } else if (type === 'chat.running') {
    patch(d.pathwayId, (t) => ({ ...t, running: !!d.running }))
  } else if (type === 'chat.reset') {
    patch(d.pathwayId, () => empty)
  }
})

void useChat.getState().loadStatus()
