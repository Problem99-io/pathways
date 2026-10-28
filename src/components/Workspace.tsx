import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ReactFlowProvider } from '@xyflow/react'
import { Bot, GitMerge, AlertCircle, User } from 'lucide-react'
import { useStore } from '../store'
import { Canvas } from './Canvas'
import { TopBar } from './TopBar'
import { NodePanel } from './NodePanel'
import { ContextPanel } from './ContextPanel'
import { AiPanel } from './AiPanel'
import { SyncPanel } from './SyncPanel'
import { ProgressBar } from './ProgressBar'
import { Search } from './Search'
import { PathOverview } from './PathOverview'
import { ForwardPanel } from './ForwardPanel'
import { ContextMenu } from './ContextMenu'

export function Workspace({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const open = useStore((s) => s.open)
  const side = useStore((s) => s.side)
  const root = useRef<HTMLDivElement>(null)

  // panels sit just below the top bar, however tall it wraps
  useEffect(() => {
    const el = root.current?.querySelector('.topbar')
    if (!el || !root.current) return
    const ro = new ResizeObserver(() => root.current?.style.setProperty('--top', `${(el as HTMLElement).offsetHeight + 22}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc?.id])

  useEffect(() => {
    open(id).catch(() => (location.hash = '#/'))
  }, [id, open])

  if (!doc || doc.id !== id) {
    return (
      <div className="loading">
        <div className="loader" />
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="workspace" ref={root}>
        <Canvas />
        <TopBar />
        <AnimatePresence>
          {side && (
            <motion.aside
              key="side"
              className="panel left"
              initial={{ x: -440, opacity: 0.4 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -440, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              {side === 'forward' && <ForwardPanel />}
              {side === 'context' && <ContextPanel />}
              {side === 'ai' && <AiPanel />}
              {side === 'sync' && <SyncPanel />}
            </motion.aside>
          )}
        </AnimatePresence>
        <PathOverview />
        <NodePanel />
        <ProgressBar />
        <Search />
        <ContextMenu />
        <Hints />
      </div>
    </ReactFlowProvider>
  )
}

function Hints() {
  const sel = useStore((s) => s.selectedId)
  return (
    <div className="hints">
      {sel ? (
        <>
          <kbd>Tab</kbd> next step <kbd>Enter</kbd> drill in <kbd>.</kbd> I’m here <kbd>C</kbd> complete <kbd>Esc</kbd> close
        </>
      ) : (
        <>
          <kbd>W</kbd> forward <kbd>⌘K</kbd> search <kbd>F</kbd> focus fog · click a path name to highlight it · double-click a step to drill in
        </>
      )}
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismiss)
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            className={`toast ${t.tone}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => dismiss(t.id)}
          >
            <span className="toast-icon">
              {t.tone === 'ai' ? <Bot size={13} /> : t.tone === 'sync' ? <GitMerge size={13} /> : t.tone === 'error' ? <AlertCircle size={13} /> : <User size={13} />}
            </span>
            <span>
              {t.who && <b>{t.who} </b>}
              {t.text}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
