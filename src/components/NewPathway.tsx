import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Plus, X, Target } from 'lucide-react'
import { api } from '../api'
import { useStore } from '../store'
import { Kinetic, softSpring } from './ui'

const CONTEXT_CHIPS = ['Budget', 'Time per week', 'Skills', 'Team', 'Audience', 'Constraints', 'Unfair advantages', 'Already tried']

export function NewPathway({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [now, setNow] = useState('')
  const [nowDetail, setNowDetail] = useState('')
  const [goals, setGoals] = useState([{ title: '', deadline: '' }])
  const [context, setContext] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = [now.trim().length > 0, goals.some((g) => g.title.trim()), true, true][step]
  const steps = [
    { q: 'Where are you right now?', sub: 'Be honest — the starting point shapes every path.' },
    { q: 'Where do you want to be?', sub: 'One goal or several. Each gets its own competing paths.' },
    { q: 'What should the AI know?', sub: 'Resources, constraints, skills, team. Optional, but it makes the paths far better.' },
    { q: 'Name this pathway', sub: 'You can change everything later.' },
  ]

  const next = async () => {
    if (!valid) return
    if (step < 3) return setStep(step + 1)
    setBusy(true)
    try {
      const realGoals = goals.filter((g) => g.title.trim()).map((g) => ({ title: g.title.trim(), deadline: g.deadline || undefined }))
      const doc = await api.create({
        title: title.trim() || realGoals[0].title,
        current: { title: now.trim(), description: nowDetail.trim() },
        goals: realGoals,
        context: context.trim(),
      })
      location.hash = `#/p/${doc.id}`
      setTimeout(() => useStore.getState().setSide('ai'), 900)
    } catch (e) {
      useStore.getState().toast({ text: (e as Error).message, tone: 'error' })
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault()
      next()
    }
    if (e.key === 'Escape') onClose()
  }

  return (
    <motion.div className="wizard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onKeyDown={onKey}>
      <button className="icon-btn wiz-close" onClick={onClose}>
        <X size={18} />
      </button>
      <div className="wiz-progress">
        {steps.map((_, i) => (
          <motion.span key={i} className={i <= step ? 'on' : ''} animate={{ scaleX: i === step ? 1 : i < step ? 1 : 0.6 }} />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} className="wiz-step" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={softSpring}>
          <div className="wiz-count">
            {step + 1} / {steps.length}
          </div>
          <Kinetic text={steps[step].q} className="wiz-q" />
          <motion.p className="wiz-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            {steps[step].sub}
          </motion.p>

          {step === 0 && (
            <>
              <input autoFocus className="wiz-input" placeholder="e.g. Designer with a SaaS idea and $5k saved" value={now} onChange={(e) => setNow(e.target.value)} />
              <textarea className="wiz-text" rows={3} placeholder="Details: what you have, what's working, what isn't…" value={nowDetail} onChange={(e) => setNowDetail(e.target.value)} />
            </>
          )}
          {step === 1 && (
            <div className="wiz-goals">
              {goals.map((g, i) => (
                <motion.div key={i} className="wiz-goal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Target size={16} className="g-icon" />
                  <input
                    autoFocus={i === goals.length - 1}
                    className="wiz-input"
                    placeholder={i === 0 ? 'e.g. $10k MRR' : 'Another goal…'}
                    value={g.title}
                    onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <input type="date" className="wiz-date" title="Deadline (optional)" value={g.deadline} onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, deadline: e.target.value } : x)))} />
                  {goals.length > 1 && (
                    <button className="icon-btn" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </button>
                  )}
                </motion.div>
              ))}
              <button className="btn ghost" onClick={() => setGoals([...goals, { title: '', deadline: '' }])}>
                <Plus size={14} /> Add another goal
              </button>
            </div>
          )}
          {step === 2 && (
            <>
              <div className="prompt-chips">
                {CONTEXT_CHIPS.map((c) => (
                  <button key={c} className="chip-btn" onClick={() => setContext((v) => (v.trim() ? `${v.trimEnd()}\n${c}: ` : `${c}: `))}>
                    + {c}
                  </button>
                ))}
              </div>
              <textarea autoFocus className="wiz-text tall" rows={7} placeholder={'Budget: $5k\nTime per week: 15h\nSkills: product design, some code\nConstraints: keep my job until revenue covers rent'} value={context} onChange={(e) => setContext(e.target.value)} />
            </>
          )}
          {step === 3 && <input autoFocus className="wiz-input" placeholder={goals.find((g) => g.title)?.title || 'My pathway'} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </motion.div>
      </AnimatePresence>
      <div className="wiz-nav">
        {step > 0 && (
          <button className="btn ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={14} /> Back
          </button>
        )}
        <span className="grow" />
        {step === 2 && (
          <button className="btn ghost" onClick={() => setStep(3)}>
            Skip
          </button>
        )}
        <button className="btn primary lg" disabled={!valid || busy} onClick={next}>
          {step === 3 ? (busy ? 'Creating…' : 'Create pathway') : 'Continue'} <ArrowRight size={14} />
        </button>
      </div>
    </motion.div>
  )
}
