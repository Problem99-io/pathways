import { create } from 'zustand'
import { applyOps, type Op } from '../shared/ops'
import type { ActivityEntry, Pathway, PathwayDoc } from '../shared/types'
import { api, subscribe, type Info } from './api'

export type SidePanel = 'forward' | 'context' | 'ai' | 'sync' | null
export type ContextTab = 'now' | 'goals' | 'context' | 'signals' | 'team' | 'refs'

export interface Toast {
  id: number
  text: string
  tone: 'ai' | 'user' | 'error' | 'sync'
  who?: string
}

interface State {
  info: Info | null
  doc: PathwayDoc | null
  selectedId: string | null
  scope: string | null // parent step we've drilled into
  focusPathId: string | null
  /** Path lit up on the canvas (others recede), without hiding anything. */
  highlightPathId: string | null
  searchOpen: boolean
  /** Ask the canvas to fly to a node. */
  flyTo: { id: string; nonce: number } | null
  fog: boolean
  navMode: 'trackpad' | 'mouse'
  personFilter: string | null
  expanded: Record<string, boolean>
  side: SidePanel
  contextTab: ContextTab
  progressOpen: boolean
  toasts: Toast[]

  open(id: string): Promise<void>
  close(): void
  dispatch(ops: Op[], message?: string): Promise<PathwayDoc | null>
  select(id: string | null): void
  enter(id: string | null): void
  setFocusPath(id: string | null): void
  setHighlight(id: string | null): void
  setSearch(open: boolean): void
  goTo(target: { nodeId?: string; pathId?: string; goalId?: string }): void
  /** Who you are on this computer (a name, matched to a person on each pathway). Saved locally only. */
  me: string | null
  setMe(name: string | null): void
  toggleFog(): void
  setNavMode(m: 'trackpad' | 'mouse'): void
  setPersonFilter(id: string | null): void
  toggleExpanded(id: string): void
  setSide(p: SidePanel, tab?: ContextTab): void
  setProgressOpen(v: boolean): void
  toast(t: Omit<Toast, 'id'>): void
  dismiss(id: number): void
}

let toastId = 0
let lastSeenActivity = ''

const readPref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(`pathways:${k}`)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}
const writePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(`pathways:${k}`, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const readMe = () => {
  try {
    return localStorage.getItem('pathways:me') || null
  } catch {
    return null
  }
}

/** The name your changes are recorded under: your picked identity, else your git name. */
export const myName = (s: Pick<State, 'me' | 'info'> = useStore.getState()) => s.me ?? s.info?.user ?? 'You'
/** Your person on this pathway, if your name matches someone on its team. */
export const mePerson = (doc: Pathway | null, me: string | null) =>
  me && doc ? doc.people.find((p) => p.name.trim().toLowerCase() === me.trim().toLowerCase()) : undefined

export const useStore = create<State>((set, get) => ({
  info: null,
  doc: null,
  selectedId: null,
  scope: null,
  focusPathId: null,
  highlightPathId: null,
  searchOpen: false,
  flyTo: null,
  me: readMe(),
  fog: readPref('fog', true),
  navMode: readPref('mouse', false) ? 'mouse' : 'trackpad',
  personFilter: null,
  expanded: {},
  side: null,
  contextTab: 'now',
  progressOpen: false,
  toasts: [],

  async open(id) {
    set({ doc: null, selectedId: null, scope: null, focusPathId: null, highlightPathId: null, personFilter: null, side: null, progressOpen: false, expanded: {} })
    const doc = await api.get(id)
    lastSeenActivity = doc.activity.at(-1)?.id ?? ''
    set({ doc })
  },
  close() {
    set({ doc: null, selectedId: null, scope: null })
  },

  async dispatch(ops, message) {
    const doc = get().doc
    if (!doc) return null
    try {
      // optimistic: apply locally first so the UI moves instantly
      set({ doc: applyOps(doc, ops) })
    } catch (e) {
      get().toast({ text: (e as Error).message, tone: 'error' })
      return null
    }
    try {
      const next = await api.ops(doc.id, ops, message, myName(get()))
      const cur = get().doc
      if (cur && cur.id === next.id && next.rev >= cur.rev) set({ doc: next })
      lastSeenActivity = next.activity.at(-1)?.id ?? lastSeenActivity
      return next
    } catch (e) {
      get().toast({ text: (e as Error).message, tone: 'error' })
      const fresh = await api.get(doc.id).catch(() => null)
      if (fresh) set({ doc: fresh })
      return null
    }
  },

  select(id) {
    set({ selectedId: id })
  },
  enter(id) {
    set({ scope: id, selectedId: null })
  },
  setFocusPath(id) {
    set({ focusPathId: id, highlightPathId: id ? null : get().highlightPathId })
  },
  setHighlight(id) {
    set({ highlightPathId: id })
  },
  setSearch(open) {
    set({ searchOpen: open })
  },
  goTo({ nodeId, pathId, goalId }) {
    const doc = get().doc
    if (!doc) return
    const nonce = Date.now()
    if (nodeId) {
      const n = doc.nodes.find((x) => x.id === nodeId)
      if (!n) return
      const focus = get().focusPathId
      set({
        scope: n.parentId,
        selectedId: n.id,
        highlightPathId: n.pathId,
        focusPathId: focus && focus !== n.pathId ? null : focus,
        flyTo: { id: n.id, nonce },
      })
    } else if (pathId) {
      set({ scope: null, highlightPathId: pathId, focusPathId: null, selectedId: null, flyTo: { id: `__path:${pathId}`, nonce } })
    } else if (goalId) {
      set({ scope: null, selectedId: null, flyTo: { id: `__goal:${goalId}`, nonce }, side: 'context', contextTab: 'goals' })
    }
  },
  setMe(name) {
    const v = name?.trim() || null
    try {
      if (v) localStorage.setItem('pathways:me', v)
      else localStorage.removeItem('pathways:me')
    } catch {
      /* ignore */
    }
    set({ me: v })
  },
  toggleFog() {
    const fog = !get().fog
    writePref('fog', fog)
    set({ fog })
  },
  setNavMode(m) {
    writePref('mouse', m === 'mouse')
    set({ navMode: m })
    get().toast({ text: m === 'trackpad' ? 'Trackpad mode: two-finger scroll pans, pinch zooms' : 'Mouse mode: wheel zooms, drag to pan', tone: 'user', who: 'View' })
  },
  setPersonFilter(id) {
    set({ personFilter: get().personFilter === id ? null : id })
  },
  toggleExpanded(id) {
    set({ expanded: { ...get().expanded, [id]: !get().expanded[id] } })
  },
  setSide(p, tab) {
    const same = get().side === p && (!tab || tab === get().contextTab)
    set({ side: same ? null : p, ...(tab ? { contextTab: tab } : {}) })
  },
  setProgressOpen(v) {
    set({ progressOpen: v })
  },
  toast(t) {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.tone === 'error' ? 6000 : 4500)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((x) => x.id !== id) })
  },
}))

// Live updates from the server: AI edits, teammates (via git pull), other tabs.
subscribe((type, data) => {
  const s = useStore.getState()
  if (type === 'pathway') {
    const next = data as PathwayDoc
    if (!s.doc || s.doc.id !== next.id || next.rev <= s.doc.rev) return
    const fresh = newEntries(next.activity)
    useStore.setState({ doc: next })
    const me = myName(s)
    for (const a of fresh.slice(-2)) {
      if (a.actor.type === 'user' && a.actor.name === me) continue
      // the chat already shows what Claude is doing
      if (a.actor.type === 'ai' && s.side === 'ai') continue
      s.toast({ text: a.message, tone: a.actor.type === 'ai' ? 'ai' : 'user', who: a.actor.name })
    }
  }
  if (type === 'external' && s.doc && (data as { id: string }).id === s.doc.id) {
    s.toast({ text: 'Pulled in changes from your team', tone: 'sync', who: 'Git' })
  }
  if (type === 'deleted' && s.doc && (data as { id: string }).id === s.doc.id) {
    location.hash = '#/'
  }
})

function newEntries(list: ActivityEntry[]) {
  const idx = list.findIndex((a) => a.id === lastSeenActivity)
  const fresh = idx === -1 ? list.slice(-1) : list.slice(idx + 1)
  lastSeenActivity = list.at(-1)?.id ?? lastSeenActivity
  return fresh
}

api.info().then((info) => useStore.setState({ info })).catch(() => {})

if (import.meta.env.DEV) (window as unknown as { __pathways: typeof useStore }).__pathways = useStore
