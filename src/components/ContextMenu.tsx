// Right-click menus. One menu at a time, opened at the cursor with
// `openMenu(e, target)`. What's in it is built fresh from the pathway each
// render (see menus.tsx), so it never shows stale state. Arrow keys move,
// → opens a submenu, ← / Esc back out, Enter picks.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { useStore } from '../store'
import { buildMenu, type MenuTarget } from './menus'
import { spring } from './ui'

export interface MenuItem {
  id: string
  label: string
  icon?: LucideIcon
  /** Shortcut hint shown on the right. */
  kbd?: string
  /** A swatch instead of an icon. */
  color?: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  /** Ask for a second click first, showing this label. */
  confirm?: string
  /** Don't close after running (toggles you may want several of). */
  keepOpen?: boolean
  items?: MenuEntry[]
  run?: () => void
}
export type MenuEntry = MenuItem | '-'
export interface MenuSpec {
  title: string
  sub?: string
  color?: string
  /** Makes the title an inline rename field. */
  rename?: (v: string) => void
  entries: MenuEntry[]
}

interface MenuState {
  at: { x: number; y: number; nonce: number } | null
  target: MenuTarget | null
  open(x: number, y: number, target: MenuTarget): void
  close(): void
}
const useMenu = create<MenuState>((set) => ({
  at: null,
  target: null,
  open: (x, y, target) => set({ at: { x, y, nonce: Date.now() }, target }),
  close: () => set({ at: null, target: null }),
}))

export function openMenu(e: React.MouseEvent | MouseEvent, target: MenuTarget) {
  e.preventDefault()
  e.stopPropagation()
  useMenu.getState().open(e.clientX, e.clientY, target)
}
export const closeMenu = () => useMenu.getState().close()

const isItem = (e: MenuEntry): e is MenuItem => e !== '-'
const usable = (e: MenuEntry): e is MenuItem => isItem(e) && !e.disabled

export function ContextMenu() {
  const at = useMenu((s) => s.at)
  const target = useMenu((s) => s.target)
  const doc = useStore((s) => s.doc)
  // a menu never outlives the pathway it was opened on
  useEffect(() => {
    if (!doc) closeMenu()
  }, [doc])
  const spec = at && target && doc ? buildMenu(target) : null
  return createPortal(<AnimatePresence>{at && spec && <Root key={at.nonce} x={at.x} y={at.y} spec={spec} />}</AnimatePresence>, document.body)
}

function Root({ x, y, spec }: { x: number; y: number; spec: MenuSpec }) {
  // trail[d] = active row at depth d; a submenu at depth d+1 is open when trail has that entry
  const [trail, setTrail] = useState<number[]>([-1])
  const [armed, setArmed] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  // while fading out it must not catch the next click or key
  const present = useIsPresent()

  const listAt = (d: number, t = trail): MenuEntry[] => {
    let list = spec.entries
    for (let i = 0; i < d; i++) {
      const it = list[t[i]]
      if (!it || !isItem(it) || !it.items) return []
      list = it.items
    }
    return list
  }

  const run = (it: MenuItem, d: number, i: number) => {
    if (it.disabled) return
    if (it.items) return setTrail((t) => [...t.slice(0, d), i, firstUsable(it.items!)])
    if (it.confirm && armed !== it.id) return setArmed(it.id)
    it.run?.()
    if (!it.keepOpen) closeMenu()
  }

  // keyboard, outside clicks, scrolling and resizing
  useEffect(() => {
    if (!present) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('.cm-rename')) {
        if (e.key === 'Escape') closeMenu()
        return
      }
      const d = trail.length - 1
      const list = listAt(d)
      const move = (dir: number) => {
        const idx = list.map((x, i) => (usable(x) ? i : -1)).filter((i) => i >= 0)
        if (!idx.length) return
        const cur = idx.indexOf(trail[d])
        const next = idx[(cur + dir + idx.length) % idx.length] ?? idx[0]
        setTrail([...trail.slice(0, d), next])
      }
      const it = list[trail[d]]
      const handled = true
      if (e.key === 'ArrowDown') move(1)
      else if (e.key === 'ArrowUp') move(-1)
      else if (e.key === 'ArrowRight' && it && isItem(it) && it.items) setTrail([...trail, firstUsable(it.items)])
      else if (e.key === 'ArrowLeft' && d > 0) setTrail(trail.slice(0, -1))
      else if ((e.key === 'Enter' || e.key === ' ') && it && isItem(it)) run(it, d, trail[d])
      else if (e.key === 'Escape') d > 0 ? setTrail(trail.slice(0, -1)) : closeMenu()
      else if (e.key === 'Tab') closeMenu()
      else return void (handled && 0)
      // the canvas listens for the same keys; the menu wins while it's open
      e.preventDefault()
      e.stopPropagation()
    }
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('.cmenu')) closeMenu()
    }
    const onWheel = (e: WheelEvent) => {
      if (!(e.target as HTMLElement).closest?.('.cmenu')) closeMenu()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('resize', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  })

  const lists = trail.map((_, d) => listAt(d)).filter((l, d) => d === 0 || l.length)
  return (
    <div className={`cm-layer ${present ? '' : 'leaving'}`} onContextMenu={(e) => e.preventDefault()}>
      {lists.map((entries, d) => (
        <List
          key={d === 0 ? 'root' : `${d}:${trail.slice(0, d).join('.')}`}
          depth={d}
          entries={entries}
          active={trail[d] ?? -1}
          armed={armed}
          anchor={d === 0 ? { x, y } : undefined}
          parentRow={d > 0 ? () => document.querySelector<HTMLElement>(`.cmenu[data-depth="${d - 1}"] [data-i="${trail[d - 1]}"]`) : undefined}
          header={
            d === 0 ? (
              <header className="cm-head" style={{ '--c': spec.color } as React.CSSProperties}>
                {spec.color && <span className="dot" style={{ background: spec.color }} />}
                <div className="cm-titles">
                  {spec.rename ? (
                    <input
                      ref={renameRef}
                      className="cm-rename"
                      defaultValue={spec.title}
                      title="Rename"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = e.currentTarget.value.trim()
                          if (v && v !== spec.title) spec.rename!(v)
                          closeMenu()
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim()
                        if (v && v !== spec.title) spec.rename!(v)
                      }}
                    />
                  ) : (
                    <b>{spec.title}</b>
                  )}
                  {spec.sub && <span>{spec.sub}</span>}
                </div>
              </header>
            ) : null
          }
          onHover={(i) => {
            const it = entries[i]
            setTrail((t) => (it && isItem(it) && it.items && !it.disabled ? [...t.slice(0, d), i, -1] : [...t.slice(0, d), i]))
            if (armed && (!it || !isItem(it) || it.id !== armed)) setArmed(null)
          }}
          onPick={(i) => {
            const it = entries[i]
            if (!it || !isItem(it)) return
            if (it.id === '__rename') {
              renameRef.current?.focus()
              renameRef.current?.select()
              return
            }
            run(it, d, i)
          }}
        />
      ))}
    </div>
  )
}

const firstUsable = (list: MenuEntry[]) => Math.max(0, list.findIndex(usable))

// Browsers replay hover when the layout under a still cursor changes (the
// highlight sliding away, a submenu closing); only real movement should steer.
let lastPointer = { x: NaN, y: NaN }
const reallyMoved = (e: React.PointerEvent) => {
  const moved = e.clientX !== lastPointer.x || e.clientY !== lastPointer.y
  lastPointer = { x: e.clientX, y: e.clientY }
  return moved
}

function List({
  depth,
  entries,
  active,
  armed,
  anchor,
  parentRow,
  header,
  onHover,
  onPick,
}: {
  depth: number
  entries: MenuEntry[]
  active: number
  armed: string | null
  anchor?: { x: number; y: number }
  parentRow?: () => HTMLElement | null
  header: React.ReactNode
  onHover: (i: number) => void
  onPick: (i: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)

  // place it, flipping away from the screen edges
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const W = window.innerWidth
    const H = window.innerHeight
    let left: number
    let top: number
    let fromRight = false
    let fromBottom = false
    if (anchor) {
      left = anchor.x + 2
      top = anchor.y + 2
      if (left + w > W - 8) ((left = Math.max(8, anchor.x - w - 2)), (fromRight = true))
      if (top + h > H - 8) ((top = Math.max(8, Math.min(anchor.y - h - 2, H - 8 - h))), (fromBottom = true))
    } else {
      const r = parentRow?.()?.getBoundingClientRect()
      if (!r) return
      left = r.right + 6
      top = r.top - 5
      if (left + w > W - 8) ((left = Math.max(8, r.left - w - 6)), (fromRight = true))
      if (top + h > H - 8) top = Math.max(8, H - 8 - h)
    }
    setPos({ left, top, origin: `${fromBottom ? 'bottom' : 'top'} ${fromRight ? 'right' : 'left'}` })
  }, [anchor, parentRow])

  return (
    <motion.div
      ref={ref}
      className="cmenu"
      data-depth={depth}
      role="menu"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.origin, visibility: pos ? 'visible' : 'hidden' }}
      initial={{ opacity: 0, scale: 0.94, y: depth ? 0 : -4, x: depth ? -6 : 0 }}
      animate={pos ? { opacity: 1, scale: 1, y: 0, x: 0 } : undefined}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={spring}
      onPointerLeave={(ev) => reallyMoved(ev) && active >= 0 && !(entries[active] as MenuItem)?.items && onHover(-1)}
    >
      {header}
      {entries.map((e, i) => {
        if (e === '-') return <div key={'sep' + i} className="cm-sep" />
        const Icon = e.icon
        const on = i === active
        const isArmed = armed === e.id
        return (
          <button
            key={e.id}
            data-i={i}
            role="menuitem"
            className={`cm-item ${e.danger ? 'danger' : ''} ${isArmed ? 'armed' : ''} ${e.disabled ? 'disabled' : ''} ${on ? 'on' : ''}`}
            onPointerMove={(ev) => reallyMoved(ev) && i !== active && onHover(i)}
            onClick={() => onPick(i)}
            disabled={e.disabled}
          >
            {on && !e.disabled && <motion.span layoutId={`cm-hl-${depth}`} className="cm-hl" transition={{ type: 'spring', stiffness: 700, damping: 45 }} />}
            <span className="cm-ic">{e.color ? <span className="cm-swatch" style={{ background: e.color }} /> : Icon ? <Icon size={13} /> : null}</span>
            <span className="cm-label">{isArmed ? e.confirm : e.label}</span>
            {e.checked && <Check size={12} className="cm-check" strokeWidth={2.6} />}
            {e.kbd && !e.items && <kbd>{e.kbd}</kbd>}
            {e.items && <ChevronRight size={12} className="cm-more" />}
          </button>
        )
      })}
    </motion.div>
  )
}
