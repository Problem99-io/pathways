import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Flag, GitBranch, Lightbulb, Repeat, Footprints, type LucideIcon } from 'lucide-react'
import type { NodeKind, Person } from '../../shared/types'
import { initials } from '../lib/format'

export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  step: Footprints,
  milestone: Flag,
  recurring: Repeat,
  decision: GitBranch,
  research: Lightbulb,
}

export const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const
export const softSpring = { type: 'spring', stiffness: 220, damping: 28 } as const

export function Avatar({ person, size = 22, ring }: { person: Person; size?: number; ring?: boolean }) {
  return (
    <span
      className={`avatar${ring ? ' ring' : ''}`}
      title={person.role ? `${person.name} · ${person.role}` : person.name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: person.color }}
    >
      {initials(person.name)}
    </span>
  )
}

export function AvatarStack({ people, max = 3, size = 22 }: { people: Person[]; max?: number; size?: number }) {
  return (
    <span className="avatar-stack">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {people.length > max && (
        <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.4 }}>
          +{people.length - max}
        </span>
      )}
    </span>
  )
}

/** Text that commits on blur / Enter. Keeps typing local so the graph doesn't re-layout per keystroke. */
export function EditableText({
  value,
  onCommit,
  multiline,
  placeholder,
  className,
  autoFocus,
}: {
  value: string
  onCommit: (v: string) => void
  multiline?: boolean
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  useEffect(() => setV(value), [value])
  useLayoutEffect(() => {
    if (multiline && ref.current) {
      ref.current.style.height = '0px'
      ref.current.style.height = ref.current.scrollHeight + 2 + 'px'
    }
  }, [v, multiline])
  const commit = () => {
    if (v !== value) onCommit(v)
  }
  const props = {
    ref,
    value: v,
    placeholder,
    autoFocus,
    className: `editable ${className ?? ''}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        commit()
        ;(e.target as HTMLElement).blur()
      }
      if (e.key === 'Escape') {
        setV(value)
        ;(e.target as HTMLElement).blur()
      }
    },
  }
  return multiline ? <textarea rows={1} {...props} /> : <input {...props} />
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string; color?: string }[]
  onChange: (v: T) => void
  layoutId: string
  size?: 'sm' | 'md'
}) {
  return (
    <div className={`segmented ${size}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={layoutId} className="seg-pill" transition={spring} style={o.color ? { background: o.color } : undefined} />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Words rise in one after another — used for headings. */
export function Kinetic({ text, className, delay = 0, as = 'h1' }: { text: string; className?: string; delay?: number; as?: 'h1' | 'h2' | 'div' }) {
  const Tag = motion[as]
  const words = text.split(' ')
  return (
    <Tag className={`kinetic ${className ?? ''}`} key={text}>
      {words.map((w, i) => (
        <span key={i}>
          <span className="kw">
            <motion.span
              initial={{ y: '110%', opacity: 0, filter: 'blur(6px)' }}
              animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
              transition={{ ...softSpring, delay: delay + i * 0.055 }}
            >
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function Section({ title, children, action, icon: Icon }: { title: string; children: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <section className="section">
      <header>
        <h4>
          {Icon && <Icon size={13} />}
          {title}
        </h4>
        {action}
      </header>
      {children}
    </section>
  )
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, fn: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fn()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', h))
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', h)
    }
  }, [ref, fn, active])
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn ghost xs"
      onClick={() => {
        navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}
