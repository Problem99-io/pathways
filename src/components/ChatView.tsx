// Chat with Claude without leaving the app. Claude works on the open
// pathway through the MCP tools, so its changes land on the canvas as it talks.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, Check, Crosshair, Loader2, RefreshCw, Settings2, Sparkles, Square, Terminal, X, AlertCircle, CircleSlash, KeyRound } from 'lucide-react'
import type { ChatMessage } from '../../shared/chat'
import { chatReady, useChat, useThread } from '../chat'
import { api } from '../api'
import { mePerson, useStore } from '../store'
import { timeAgo } from '../lib/format'
import { Avatar, CopyButton, Kinetic, softSpring, spring } from './ui'

export function ChatView() {
  const doc = useStore((s) => s.doc)!
  const status = useChat((s) => s.status)
  const thread = useThread(doc.id)
  const load = useChat((s) => s.load)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    void load(doc.id)
  }, [doc.id, load])

  if (!status) return <div className="chat-loading"><Loader2 size={16} className="spin" /></div>
  const ready = chatReady(status)
  return (
    <div className="chat">
      {(!ready || settings) && <Setup onDone={() => setSettings(false)} showClose={ready} />}
      {ready && !settings && (
        <>
          <Messages messages={thread.messages} running={thread.running} />
          <Composer running={thread.running} onSettings={() => setSettings(true)} hasHistory={thread.messages.length > 0} />
        </>
      )}
    </div>
  )
}

// ---------- messages ----------

function Messages({ messages, running }: { messages: ChatMessage[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // stay at the bottom while a reply streams, unless you've scrolled up to read
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })
  return (
    <div
      className="chat-scroll"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {messages.length === 0 ? (
        <Welcome />
      ) : (
        <div className="chat-list">
          {messages.map((m, i) => (
            <Message key={m.id} m={m} last={i === messages.length - 1} running={running} retry={i === messages.length - 1 && !running && (!!m.error || !!m.stopped) ? messages.slice(0, i).reverse().find((x) => x.role === 'user') : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}

function Welcome() {
  const doc = useStore((s) => s.doc)!
  const send = useChat((s) => s.send)
  const prompts = [
    'Generate 3 genuinely different paths to each goal and tell me which is quickest',
    'What should I do next across everything I’m pursuing?',
    'Something changed — help me re-plan',
    'Break the step I’m on into concrete sub-steps',
  ]
  return (
    <motion.div className="chat-welcome" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
      <span className="chat-orb">
        <Sparkles size={18} />
      </span>
      <Kinetic as="div" className="chat-title" text="Plan out loud" />
      <p>Ask Claude anything about “{doc.title}”. It reads the plan and changes it right here as you talk.</p>
      <div className="chat-suggest">
        {prompts.map((p, i) => (
          <motion.button
            key={p}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...softSpring, delay: 0.12 + i * 0.05 }}
            onClick={() => void send(doc.id, p).catch(() => {})}
          >
            {p}
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

function Message({ m, last, running, retry }: { m: ChatMessage; last: boolean; running: boolean; retry?: ChatMessage }) {
  const doc = useStore((s) => s.doc)!
  const send = useChat((s) => s.send)
  const person = m.by ? mePerson(doc, m.by) : undefined
  if (m.role === 'user') {
    return (
      <motion.div className="msg user" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
        <div className="msg-meta">
          {m.context && (
            <span className="msg-ctx">
              <Crosshair size={10} /> {m.context}
            </span>
          )}
          <span className="grow" />
          <span>{m.by}</span>
          {person && <Avatar person={person} size={16} />}
        </div>
        <div className="bubble">{m.text}</div>
      </motion.div>
    )
  }
  const thinking = m.pending && !m.text && !m.tools?.length
  return (
    <motion.div className="msg ai" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
      <div className="msg-meta">
        <span className={`msg-orb ${m.pending ? 'live' : ''}`}>
          <Sparkles size={10} />
        </span>
        <span>Claude</span>
        <span className="faint">{timeAgo(m.at)}</span>
        {!m.pending && m.ms && <span className="faint">· {Math.max(1, Math.round(m.ms / 1000))}s</span>}
      </div>
      {!!m.tools?.length && (
        <ul className="msg-tools">
          <AnimatePresence initial={false}>
            {m.tools.map((t) => (
              <motion.li key={t.id} className={`tool-row ${t.state}`} initial={{ opacity: 0, x: -6, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }} transition={softSpring}>
                {t.state === 'running' ? <Loader2 size={11} className="spin" /> : t.state === 'ok' ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
                <span>{t.summary}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {thinking && (
        <div className="thinking">
          <i />
          <i />
          <i />
        </div>
      )}
      {m.text && (
        <div className="msg-text">
          <Markdown text={m.text} />
          {m.pending && last && running && <span className="caret" />}
        </div>
      )}
      {m.stopped && !m.error && (
        <div className="msg-note">
          <CircleSlash size={11} /> Stopped
        </div>
      )}
      {m.error && (
        <div className="msg-error">
          <AlertCircle size={12} />
          <span>{m.error}</span>
        </div>
      )}
      {retry && (
        <button className="retry-btn" onClick={() => void send(doc.id, retry.text).catch(() => {})}>
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </motion.div>
  )
}

// ---------- composer ----------

function Composer({ running, onSettings, hasHistory }: { running: boolean; onSettings: () => void; hasHistory: boolean }) {
  const doc = useStore((s) => s.doc)!
  const selectedId = useStore((s) => s.selectedId)
  const draft = useChat((s) => s.draft)
  const setDraft = useChat((s) => s.setDraft)
  const send = useChat((s) => s.send)
  const stop = useChat((s) => s.stop)
  const clear = useChat((s) => s.clear)
  const [withCtx, setWithCtx] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const sel = selectedId ? doc.nodes.find((n) => n.id === selectedId) : undefined
  const selPath = sel ? doc.paths.find((p) => p.id === sel.pathId) : undefined
  useEffect(() => setWithCtx(true), [selectedId])

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [draft])
  useEffect(() => {
    ta.current?.focus()
  }, [])

  const submit = () => {
    const text = draft.trim()
    if (!text || running) return
    const context =
      sel && withCtx
        ? { label: sel.title, prompt: `(I have the step “${sel.title}” selected — id ${sel.id}, on the path “${selPath?.name ?? ''}”.)` }
        : undefined
    setDraft('')
    void send(doc.id, text, context).catch(() => setDraft(text))
  }

  return (
    <div className="composer">
      <AnimatePresence>
        {sel && (
          <motion.button
            className={`ctx-chip ${withCtx ? 'on' : ''}`}
            style={{ '--c': selPath?.color } as React.CSSProperties}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            onClick={() => setWithCtx((v) => !v)}
            title={withCtx ? 'Claude will know you mean this step — click to leave it out' : 'Click to tell Claude about this step'}
          >
            <Crosshair size={11} />
            <span>{sel.title}</span>
            {withCtx ? <X size={11} /> : <span className="faint">add</span>}
          </motion.button>
        )}
      </AnimatePresence>
      <div className="composer-box">
        <textarea
          ref={ta}
          value={draft}
          placeholder={running ? 'Claude is working…' : 'Ask Claude to plan, re-plan, research…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') ta.current?.blur()
          }}
          rows={1}
        />
        {running ? (
          <button className="send stop" onClick={() => stop(doc.id)} title="Stop">
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button className="send" disabled={!draft.trim()} onClick={submit} title="Send (Enter)">
            <ArrowUp size={14} strokeWidth={2.6} />
          </button>
        )}
      </div>
      <div className="composer-foot">
        <span className="faint">Enter to send · Shift+Enter for a new line</span>
        <span className="grow" />
        {hasHistory && (
          <button
            className={`link-btn ${confirmClear ? 'danger' : ''}`}
            onClick={() => {
              if (!confirmClear) return setConfirmClear(true)
              setConfirmClear(false)
              void clear(doc.id)
            }}
            onBlur={() => setConfirmClear(false)}
            disabled={running}
          >
            {confirmClear ? 'Clear the history?' : 'New chat'}
          </button>
        )}
        <button className="icon-btn sm" onClick={onSettings} title="Chat settings">
          <Settings2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ---------- setup ----------

function Setup({ onDone, showClose }: { onDone: () => void; showClose: boolean }) {
  const status = useChat((s) => s.status)!
  const loadStatus = useChat((s) => s.loadStatus)
  const [path, setPath] = useState(status.path ?? '')
  const [model, setModel] = useState(status.model ?? '')
  const [checking, setChecking] = useState(false)
  const bin = status.path ? (/\s/.test(status.path) ? `"${status.path}"` : status.path) : 'claude'
  const check = async () => {
    setChecking(true)
    await loadStatus(true)
    setChecking(false)
  }
  const saveSettings = async () => {
    setChecking(true)
    const st = await api.chatSettings({ claudePath: path.trim() || undefined, model: model.trim() || undefined }).catch(() => null)
    if (st) useChat.setState({ status: st })
    setChecking(false)
    if (st && chatReady(st)) onDone()
  }
  return (
    <motion.div className="chat-setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
      <div className="row">
        <span className="chat-orb sm">
          <Sparkles size={14} />
        </span>
        <b className="grow">{showClose ? 'Chat settings' : 'Chat with Claude here'}</b>
        {showClose && (
          <button className="icon-btn sm" onClick={onDone}>
            <X size={13} />
          </button>
        )}
      </div>
      {!status.available && (
        <>
          <p className="hint">The chat runs Claude Code on this computer. Install it once:</p>
          <Cmd text="curl -fsSL https://claude.ai/install.sh | bash" />
          <p className="hint">Then log in, and come back here:</p>
          <Cmd text="claude auth login" />
        </>
      )}
      {status.available && !status.loggedIn && (
        <>
          <p className="hint">
            Found Claude Code {status.version} on this computer, but it isn’t logged in on its own. Log in once in a terminal, then check again:
          </p>
          <Cmd text={`${bin} auth login`} />
          <p className="hint">
            Or start Pathways with <code>ANTHROPIC_API_KEY</code> set to use an API key.
          </p>
        </>
      )}
      {status.available && status.loggedIn && (
        <p className="hint">
          <Check size={11} /> Claude Code {status.version} is ready{status.authMethod && status.authMethod !== 'none' ? ` (${status.authMethod})` : ''}. Chats stay on this computer.
        </p>
      )}
      <div className="setup-fields">
        <label>
          <span>Claude Code binary</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="found automatically" spellCheck={false} />
        </label>
        <label>
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Claude Code’s default" spellCheck={false} />
        </label>
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={() => void (path !== (status.path ?? '') || model !== (status.model ?? '') ? saveSettings() : check())} disabled={checking}>
          {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {path !== (status.path ?? '') || model !== (status.model ?? '') ? 'Save & check' : 'Check again'}
        </button>
        <span className="grow" />
        {!status.available ? <Terminal size={13} className="faint" /> : !status.loggedIn ? <KeyRound size={13} className="faint" /> : null}
      </div>
    </motion.div>
  )
}

function Cmd({ text }: { text: string }) {
  return (
    <div className="cmd">
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  )
}

// ---------- a little markdown ----------

/** Paragraphs, lists, headings, code, bold/italic, links — enough for chat. Renders as React, never raw HTML. */
function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === 'code') return <pre key={i}>{b.text}</pre>
        if (b.t === 'h') return <h5 key={i}>{inline(b.text)}</h5>
        if (b.t === 'ul' || b.t === 'ol') {
          const L = b.t
          return (
            <L key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </L>
          )
        }
        return <p key={i}>{inline((b as { text: string }).text)}</p>
      })}
    </>
  )
}

type Block = { t: 'p' | 'h' | 'code'; text: string } | { t: 'ul' | 'ol'; items: string[] }

function parseBlocks(src: string): Block[] {
  const out: Block[] = []
  const lines = src.replace(/\r/g, '').split('\n')
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('```')) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      out.push({ t: 'code', text: code.join('\n') })
      continue
    }
    const h = /^#{1,6}\s+(.*)/.exec(l)
    const ul = /^\s*[-*•]\s+(.*)/.exec(l)
    const ol = /^\s*\d+[.)]\s+(.*)/.exec(l)
    if (h) {
      flush()
      out.push({ t: 'h', text: h[1] })
    } else if (ul || ol) {
      flush()
      const t = ul ? 'ul' : 'ol'
      const last = out[out.length - 1]
      if (last && last.t === t) last.items.push((ul ?? ol)![1])
      else out.push({ t, items: [(ul ?? ol)![1]] })
    } else if (!l.trim()) flush()
    else {
      const last = out[out.length - 1]
      // an indented line continues the list item above it
      if (!para.length && last && (last.t === 'ul' || last.t === 'ol') && /^\s{2,}/.test(l)) last.items[last.items.length - 1] += ' ' + l.trim()
      else para.push(l)
    }
  }
  flush()
  return out
}

function inline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(<Fragment key={k++}>{s.slice(last, m.index)}</Fragment>)
    const tok = m[0]
    if (m[1]) parts.push(<code key={k++}>{tok.slice(1, -1)}</code>)
    else if (m[2]) parts.push(<b key={k++}>{tok.slice(2, -2)}</b>)
    else if (m[3]) parts.push(<em key={k++}>{tok.slice(1, -1)}</em>)
    else if (m[4]) {
      const label = tok.slice(1, tok.indexOf(']('))
      parts.push(
        <a key={k++} href={m[5]} target="_blank" rel="noreferrer">
          {label}
        </a>,
      )
    }
    last = m.index + tok.length
  }
  if (last < s.length) parts.push(<Fragment key={k++}>{s.slice(last)}</Fragment>)
  return parts
}
