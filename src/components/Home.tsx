import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, ArrowRight, Target, Trash2, FolderGit2 } from 'lucide-react'
import type { PathwaySummary } from '../../shared/types'
import { api, subscribe } from '../api'
import { timeAgo } from '../lib/format'
import { AvatarStack, Kinetic, softSpring } from './ui'
import { NewPathway } from './NewPathway'
import { useGit } from './SyncPanel'

export function Home() {
  const [list, setList] = useState<PathwaySummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const git = useGit()

  useEffect(() => {
    const load = () => api.list().then(setList).catch(() => setList([]))
    load()
    return subscribe(() => load())
  }, [])

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand">
          <Logo />
          <span>Pathways</span>
        </div>
        <div className="grow" />
        {git?.status.repo && (
          <span className="home-git" title={git.workspace}>
            <FolderGit2 size={13} /> {git.status.branch}
            {git.status.remote ? ' · synced with remote' : ' · local repo'}
          </span>
        )}
      </header>

      <section className="hero">
        <Kinetic text="From where you are to where you want to be." />
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
          Map every route to your goals, let AI explore the possibilities, and follow the quickest one — step by step.
        </motion.p>
      </section>

      <div className="cards">
        <motion.button className="card new" onClick={() => setCreating(true)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.15 }} whileHover={{ y: -3 }}>
          <span className="new-icon">
            <Plus size={20} />
          </span>
          <b>New pathway</b>
          <span className="faint">Start from where you are</span>
        </motion.button>
        <AnimatePresence>
          {list?.map((p, i) => (
            <motion.a
              key={p.id}
              href={`#/p/${p.id}`}
              className="card"
              layout
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ ...softSpring, delay: 0.2 + i * 0.04 }}
              whileHover={{ y: -3 }}
            >
              <div className="card-lanes">
                {(p.colors.length ? p.colors : ['#2a3346']).slice(0, 5).map((c, j) => (
                  <svg key={j} viewBox="0 0 200 20" preserveAspectRatio="none">
                    <path d={`M0 10 C 50 10, 60 ${4 + j * 3}, 100 ${4 + j * 3} S 160 10, 200 10`} stroke={c} strokeWidth="2" fill="none" strokeOpacity="0.8" />
                  </svg>
                ))}
              </div>
              <b className="card-title">{p.title}</b>
              <div className="card-route">
                <span>{p.current}</span>
                <ArrowRight size={12} />
                <span className="card-goals">
                  {p.goals.map((g) => (
                    <span key={g}>
                      <Target size={10} /> {g}
                    </span>
                  ))}
                </span>
              </div>
              <div className="card-foot">
                <span className="faint sm">
                  {p.paths} path{p.paths === 1 ? '' : 's'} · {p.done}/{p.steps} steps
                </span>
                <span className="grow" />
                <AvatarStack people={p.people} size={20} />
                <span className="faint sm">{timeAgo(p.updatedAt)}</span>
              </div>
              <div className="card-progress">
                <span style={{ width: `${p.steps ? (p.done / p.steps) * 100 : 0}%` }} />
              </div>
              <button
                className={`card-del ${confirm === p.id ? 'armed' : ''}`}
                title="Delete pathway"
                onClick={(e) => {
                  e.preventDefault()
                  if (confirm === p.id) api.remove(p.id)
                  else setConfirm(p.id)
                }}
                onMouseLeave={() => setConfirm(null)}
              >
                <Trash2 size={12} /> {confirm === p.id ? 'Delete?' : ''}
              </button>
            </motion.a>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>{creating && <NewPathway onClose={() => setCreating(false)} />}</AnimatePresence>
    </div>
  )
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="logo">
      <circle cx="7" cy="16" r="3" fill="#5EEAD4" />
      <circle cx="25" cy="8" r="3" fill="#A78BFA" />
      <circle cx="25" cy="24" r="3" fill="#60A5FA" />
      <path className="logo-path a" d="M10 16 C17 16 16 8 22 8" stroke="#5EEAD4" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path className="logo-path b" d="M10 16 C17 16 16 24 22 24" stroke="#5EEAD4" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}
