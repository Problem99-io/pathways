// "Who are you?" — pick yourself from the team (or type a name). Kept in this
// browser only, never written to the pathway, so everyone sharing the git repo
// picks their own. Changes, requests and "assign to me" use it.

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, GitCommit, LogOut, UserPlus, UserRound } from 'lucide-react'
import { uid } from '../../shared/ops'
import { mePerson, useStore } from '../store'
import { initials } from '../lib/format'
import { Avatar, spring, useClickOutside } from './ui'

export function WhoAmI() {
  const doc = useStore((s) => s.doc)!
  const me = useStore((s) => s.me)
  const gitName = useStore((s) => s.info?.user)
  const [open, setOpen] = useState<DOMRect | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const person = mePerson(doc, me)
  return (
    <>
      <button
        ref={btn}
        className={`whoami ${!me ? 'unset' : ''} ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => (v ? null : btn.current!.getBoundingClientRect()))}
        title={me ? `You’re ${me} on this computer — click to change` : 'Who are you? Pick yourself so your changes are yours'}
      >
        {person ? (
          <Avatar person={person} size={26} ring />
        ) : me ? (
          <span className="whoami-initials">{initials(me)}</span>
        ) : (
          <UserRound size={15} />
        )}
        {!me && <span className="live-dot" />}
      </button>
      {createPortal(<AnimatePresence>{open && <Picker anchor={open} onClose={() => setOpen(null)} gitName={gitName} />}</AnimatePresence>, document.body)}
    </>
  )
}

function Picker({ anchor, onClose, gitName }: { anchor: DOMRect; onClose: () => void; gitName?: string }) {
  const doc = useStore((s) => s.doc)!
  const me = useStore((s) => s.me)
  const setMe = useStore((s) => s.setMe)
  const dispatch = useStore((s) => s.dispatch)
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  useClickOutside(ref, onClose)
  const person = mePerson(doc, me)
  const pick = (n: string) => {
    setMe(n)
    useStore.getState().toast({ text: `You’re ${n} on this computer`, tone: 'user', who: 'You' })
    onClose()
  }
  const gitIsPerson = !!gitName && !!mePerson(doc, gitName)
  return (
    <motion.div
      ref={ref}
      className="menu whoami-menu"
      style={{ position: 'fixed', top: anchor.bottom + 8, left: Math.max(8, anchor.right - 280) }}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4 }}
      transition={spring}
    >
      <div className="menu-pad">
        <b>Who are you?</b>
        <p className="hint">Saved on this computer only. Your edits, AI requests and “assign to me” use this name.</p>
      </div>
      {doc.people.length > 0 && <div className="menu-sep" />}
      {doc.people.map((p) => (
        <button key={p.id} className="menu-item" onClick={() => pick(p.name)}>
          <Avatar person={p} size={20} />
          <span className="grow">
            {p.name}
            {p.role && <span className="faint sm"> · {p.role}</span>}
          </span>
          {person?.id === p.id && <Check size={13} className="cm-check" />}
        </button>
      ))}
      {gitName && !gitIsPerson && (
        <button className="menu-item" onClick={() => pick(gitName)}>
          <GitCommit size={14} />
          <span className="grow">Use my git name · {gitName}</span>
          {me === gitName && <Check size={13} className="cm-check" />}
        </button>
      )}
      <div className="menu-sep" />
      <form
        className="whoami-new"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) pick(name.trim())
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Someone else — type your name" />
      </form>
      {me && !person && (
        <button
          className="menu-item"
          onClick={() => {
            dispatch([{ t: 'person.add', person: { id: uid(), name: me } }])
            onClose()
          }}
        >
          <UserPlus size={14} /> Add {me} to this pathway’s team
        </button>
      )}
      {me && (
        <button
          className="menu-item"
          onClick={() => {
            setMe(null)
            onClose()
          }}
        >
          <LogOut size={14} /> Forget me on this computer
        </button>
      )}
    </motion.div>
  )
}
