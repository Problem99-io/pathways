import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  useReactFlow,
  useViewport,
  ViewportPortal,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { AnimatePresence, motion } from 'motion/react'
import { Sparkles, PenLine, Hand, Mouse } from 'lucide-react'
import { rankByGoal, pathMetrics } from '../../shared/metrics'
import { computeLayout, START_ID, STEP_W, type LaidOutNode } from '../lib/layout'
import { useSpringPositions } from '../lib/springs'
import { useStore } from '../store'
import { nodeTypes, YouAreHerePin } from './nodes'
import { edgeTypes } from './edges'
import { addNext, complete, drillInto, newPath, setCurrent } from '../lib/actions'
import { Kinetic, softSpring } from './ui'
import { openMenu } from './ContextMenu'
import { FIT_EVENT } from './menus'
import type { FlowEdgeData } from '../lib/layout'

const pinKey = (id: string) => `__pin:${id}`

export function Canvas() {
  const doc = useStore((s) => s.doc)!
  const scope = useStore((s) => s.scope)
  const focusPathId = useStore((s) => s.focusPathId)
  const highlightPathId = useStore((s) => s.highlightPathId)
  const flyTo = useStore((s) => s.flyTo)
  const fog = useStore((s) => s.fog)
  const personFilter = useStore((s) => s.personFilter)
  const expanded = useStore((s) => s.expanded)
  const selectedId = useStore((s) => s.selectedId)
  const { fitBounds, setCenter, getZoom } = useReactFlow()
  const layoutRef = useRef<ReturnType<typeof computeLayout>>(null!)
  /** Frame nodes by their layout targets (not their animated positions). */
  const frame = useCallback(
    (ids: string[] | null, opts: { padding: number; maxZoom: number; duration?: number; leftInset?: number }) => {
      const l = layoutRef.current
      const list = ids ? l.nodes.filter((n) => ids.includes(n.id)) : l.nodes
      if (!list.length) return
      let x0 = Math.min(...list.map((n) => n.x))
      const y0 = Math.min(...list.map((n) => n.y))
      const x1 = Math.max(...list.map((n) => n.x + n.w))
      const y1 = Math.max(...list.map((n) => n.y + n.h))
      if (opts.leftInset) {
        // leave room for a panel on the left: grow the box by the panel's width in flow units
        const el = document.querySelector('.canvas')!
        const W = el.clientWidth * (1 - 2 * opts.padding)
        const H = el.clientHeight * (1 - 2 * opts.padding)
        let ext = 0
        for (let i = 0; i < 3; i++) {
          const z = Math.min(W / (x1 - x0 + ext), H / (y1 - y0), opts.maxZoom)
          ext = opts.leftInset / z
        }
        x0 -= ext
      }
      fitBounds({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, { padding: opts.padding, duration: opts.duration ?? 800 })
      if (getZoom() > opts.maxZoom) setTimeout(() => setCenter((x0 + x1) / 2, (y0 + y1) / 2, { zoom: opts.maxZoom, duration: 300 }), (opts.duration ?? 800) + 20)
    },
    [fitBounds, getZoom, setCenter],
  )

  const { metrics, best } = useMemo(() => {
    const metrics = Object.fromEntries(doc.paths.map((p) => [p.id, pathMetrics(doc, p.id)]))
    const ranks = rankByGoal(doc)
    return { metrics, best: Object.fromEntries(Object.entries(ranks).map(([g, r]) => [g, r.quickest])) }
  }, [doc])

  const layout = useMemo(
    () => computeLayout(doc, { scope, focusPathId, highlightPathId, fog, personFilter, expanded, metrics, best }),
    [doc, scope, focusPathId, highlightPathId, fog, personFilter, expanded, metrics, best],
  )

  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout])
  layoutRef.current = layout
  const pinNodes = useMemo(
    () => layout.pins.map((p) => ({ ...p, node: byId.get(p.id) })).filter((p): p is typeof p & { node: LaidOutNode } => !!p.node),
    [layout, byId],
  )

  const targets = useMemo(() => {
    const m = new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
    for (const p of pinNodes) m.set(pinKey(p.pathId ?? p.id), { x: p.node.x + p.node.w / 2, y: p.node.y })
    return m
  }, [layout, pinNodes])

  const bodiesRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const spawnFrom = useCallback(
    (id: string) => {
      const bodies = bodiesRef.current
      // a path's pin glides from the start when it first appears
      if (id.startsWith('__pin:')) {
        const s = bodies.get(START_ID)
        return s ? { x: s.x + 130, y: s.y } : undefined
      }
      // new steps grow out of the step before them
      const n = byId.get(id)
      if (n?.type === 'step') {
        const dep = (n.data as { node: { dependsOn: string[] } }).node.dependsOn.find((d) => bodies.has(d))
        if (dep) return bodies.get(dep)
      }
      return undefined
    },
    [byId],
  )
  const bodies = useSpringPositions(targets, spawnFrom)
  bodiesRef.current = bodies

  // React Flow measures nodes and reports sizes through onNodesChange; feed them
  // back or it re-hides every node to measure again on each update.
  const measured = useRef(new Map<string, { width: number; height: number }>())
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let changed = false
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) {
        const prev = measured.current.get(c.id)
        if (!prev || prev.width !== c.dimensions.width || prev.height !== c.dimensions.height) {
          measured.current.set(c.id, c.dimensions)
          changed = true
        }
      }
    }
    if (changed) bump()
  }, [])

  const nodes: Node[] = layout.nodes.map((n: LaidOutNode) => {
    const b = bodies.get(n.id) ?? n
    return {
      measured: measured.current.get(n.id),
      id: n.id,
      type: n.type,
      position: { x: b.x, y: b.y },
      data: n.data,
      selected: n.id === selectedId,
      draggable: false,
      connectable: n.type === 'step',
      style: { width: n.w },
      zIndex: n.type === 'lane' ? 0 : 1,
    }
  })
  const edges: Edge[] = layout.edges.map((e) => ({
    ...e,
    sourceHandle: e.type === 'loop' ? 'loop-out' : undefined,
    targetHandle: e.type === 'loop' ? 'loop-in' : undefined,
    selectable: false,
  }))

  // Re-frame when switching pathway, scope or path filter. With the fog on we
  // open on where you are and what's next, at a readable zoom; otherwise everything.
  const frameKey = `${doc.id}|${scope}|${focusPathId}`
  const framed = useRef('')
  useEffect(() => {
    if (framed.current === frameKey) return
    const t = setTimeout(() => {
      framed.current = frameKey
      const l = layoutRef.current
      // every front you're on, plus what's right after it
      const pinIds = new Set(l.pins.map((p) => p.id))
      const clear = l.nodes.filter((n) => pinIds.has(n.id) || (n.type === 'step' && (n.data as { next: boolean }).next))
      const near = clear.length > 1 && fog && !scope ? clear.slice(0, 14) : null
      if (near) frame([...near.map((n) => n.id), START_ID], { padding: 0.18, maxZoom: 0.95 })
      else frame(null, { padding: 0.12, maxZoom: 1 })
    }, 60)
    return () => clearTimeout(t)
  }, [frameKey, frame, fog, scope])

  // fly to a search result / path / goal once it exists in the current layout
  useEffect(() => {
    if (!flyTo) return
    const t = setTimeout(() => {
      const target = useStore.getState().flyTo
      if (!target || target.nonce !== flyTo.nonce) return
      const n = layoutRef.current.nodes.find((x) => x.id === target.id)
      if (!n) return
      if (n.type === 'lane') {
        // frame the whole lane
        const ids = layoutRef.current.nodes
          .filter((x) => x.type === 'step' && (x.data as { node: { pathId: string } }).node.pathId === target.id.slice(7))
          .map((x) => x.id)
        frame([n.id, ...ids], { padding: 0.08, maxZoom: 1, duration: 750, leftInset: 340 })
      } else {
        // keep the step clear of the path overview (left) and the step panel (right)
        const zoom = Math.max(getZoom(), 0.9)
        const s = useStore.getState()
        const shift = ((s.highlightPathId && !s.side ? 340 : 0) - (s.selectedId ? 410 : 0)) / 2 / zoom
        setCenter(n.x + n.w / 2 - shift, n.y + n.h / 2, { zoom, duration: 750 })
      }
    }, 120)
    return () => clearTimeout(t)
  }, [flyTo, frame, setCenter, getZoom])

  // "Fit everything" from the canvas menu
  useEffect(() => {
    const fit = () => frame(null, { padding: 0.12, maxZoom: 1 })
    window.addEventListener(FIT_EVENT, fit)
    return () => window.removeEventListener(FIT_EVENT, fit)
  }, [frame])

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source.startsWith('__') || c.target.startsWith('__')) return
    useStore.getState().dispatch([{ t: 'edge.add', source: c.source, target: c.target }])
  }, [])

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest?.('input, textarea, select, [contenteditable=true]')) return
      const s = useStore.getState()
      const sel = s.selectedId ? s.doc?.nodes.find((n) => n.id === s.selectedId) : undefined
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
        e.preventDefault()
        s.setSearch(true)
        return
      }
      if (e.key === 'Escape') {
        if (s.selectedId) s.select(null)
        else if (s.highlightPathId) s.setHighlight(null)
        else if (s.side) s.setSide(null)
        else if (s.scope) s.enter(s.doc?.nodes.find((n) => n.id === s.scope)?.parentId ?? null)
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) s.toggleFog()
      else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) s.setSide('forward')
      else if ((e.key === 'Tab' || e.key === 'n') && sel) {
        e.preventDefault()
        addNext(sel)
      } else if (e.key === 'Enter' && sel) drillInto(sel)
      else if (e.key === '.' && sel) setCurrent(sel.id)
      else if (e.key === 'c' && sel && !e.metaKey && !e.ctrlKey) complete(sel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const trackpad = useStore((s) => s.navMode) === 'trackpad'
  const empty = !scope && doc.paths.filter((p) => p.status !== 'archived').length === 0

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => {
          const s = useStore.getState()
          if (n.type === 'step') s.select(n.id)
          else if (n.type === 'lane') s.setHighlight(s.highlightPathId === n.id.slice(7) ? null : n.id.slice(7))
          else if (n.type === 'start') s.scope ? s.select(s.scope) : s.setSide('context', 'now')
          else if (n.type === 'goal') s.scope ? s.select(s.scope) : s.setSide('context', 'goals')
        }}
        onNodeDoubleClick={(_, n) => {
          const node = useStore.getState().doc?.nodes.find((x) => x.id === n.id)
          if (node) drillInto(node)
        }}
        onPaneClick={() => useStore.getState().select(null)}
        onNodeContextMenu={(e, n) => {
          if (n.type === 'step') openMenu(e, { kind: 'step', id: n.id })
          else if (n.type === 'lane') openMenu(e, { kind: 'path', id: n.id.slice(7) })
          else if (n.type === 'goal') openMenu(e, { kind: 'goal', id: n.id.slice(7) })
          else if (n.type === 'start') openMenu(e, { kind: 'start' })
          else openMenu(e, { kind: 'pane' })
        }}
        onEdgeContextMenu={(e, edge) => openMenu(e, { kind: 'edge', source: edge.source, target: edge.target, insert: (edge.data as FlowEdgeData | undefined)?.insert })}
        onPaneContextMenu={(e) => openMenu(e as React.MouseEvent, { kind: 'pane' })}
        nodesDraggable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.15}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        defaultViewport={{ x: 80, y: 120, zoom: 0.6 }}
        // trackpad: two-finger scroll pans, pinch (or ⌘ + scroll) zooms. mouse: wheel zooms, drag pans
        panOnScroll={trackpad}
        panOnScrollMode={PanOnScrollMode.Free}
        panOnScrollSpeed={0.9}
        zoomOnScroll={!trackpad}
        zoomOnPinch
        zoomActivationKeyCode={trackpad ? ['Meta', 'Control'] : null}
        panOnDrag
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#1a2232" />
        <Controls showInteractive={false} position="bottom-left" className="controls">
          <ControlButton
            onClick={() => useStore.getState().setNavMode(trackpad ? 'mouse' : 'trackpad')}
            title={trackpad ? 'Trackpad mode: scroll to pan, pinch to zoom. Click for mouse mode' : 'Mouse mode: wheel to zoom, drag to pan. Click for trackpad mode'}
          >
            {trackpad ? <Hand size={13} /> : <Mouse size={13} />}
          </ControlButton>
        </Controls>
        <ViewportPortal>
          {pinNodes.map((p) => {
            const b = bodies.get(pinKey(p.pathId ?? p.id))
            if (!b) return null
            const path = p.pathId ? doc.paths.find((x) => x.id === p.pathId) : undefined
            return (
              <div key={p.pathId ?? p.id} className="you-pin-wrap" style={{ transform: `translate(${b.x}px, ${b.y}px)`, '--c': p.color } as React.CSSProperties}>
                <YouAreHerePin label={pinNodes.length > 1 && path ? path.name : undefined} />
              </div>
            )
          })}
        </ViewportPortal>
      </ReactFlow>
      {fog && pinNodes.length > 0 && <FogOverlay clearings={pinNodes.map((p) => ({ node: p.node, pos: bodies.get(p.id) ?? p.node }))} />}
      <AnimatePresence>{empty && <EmptyState />}</AnimatePresence>
    </div>
  )
}

/** Atmospheric mist everywhere except a clearing around each place you are and what's next. */
function FogOverlay({ clearings }: { clearings: { node: LaidOutNode; pos: { x: number; y: number } }[] }) {
  const { x, y, zoom } = useViewport()
  const layers = clearings.map(({ node, pos }) => {
    const isStart = node.id === START_ID
    const cx = (pos.x + node.w / 2 + (isStart ? STEP_W * 0.9 : STEP_W * 0.75)) * zoom + x
    const cy = (pos.y + node.h / 2) * zoom + y
    const r = STEP_W * (isStart ? 1.9 : 1.6) * zoom
    return `radial-gradient(ellipse ${r * 1.25}px ${r * 0.8}px at ${cx}px ${cy}px, transparent 0%, transparent 45%, rgba(0,0,0,0.55) 75%, #000 100%)`
  })
  // intersect the layers: the mist is opaque only where every layer is, so each clearing shows through
  const mask = layers.join(', ')
  const composite = layers.map(() => 'intersect').join(', ')
  const webkitComposite = layers.map(() => 'source-in').join(', ')
  return (
    <motion.div
      className="fog"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
      style={{ WebkitMaskImage: mask, maskImage: mask, maskComposite: composite, WebkitMaskComposite: webkitComposite } as React.CSSProperties}
    >
      <div className="mist m1" />
      <div className="mist m2" />
      <div className="mist m3" />
    </motion.div>
  )
}

function EmptyState() {
  const setSide = useStore((s) => s.setSide)
  return (
    <motion.div className="empty-state" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={softSpring}>
      <Kinetic as="h2" text="Map the way from here to there" />
      <p>Let your AI explore several routes to each goal, or sketch one yourself. You can always reshape it later.</p>
      <div className="row">
        <button className="btn primary" onClick={() => setSide('ai')}>
          <Sparkles size={14} /> Generate paths with AI
        </button>
        <button className="btn" onClick={() => newPath()}>
          <PenLine size={14} /> Sketch a path myself
        </button>
      </div>
    </motion.div>
  )
}
