import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp, GitBranch, GitCommitHorizontal, RefreshCw, X, AlertTriangle, FolderGit2, CircleDot } from 'lucide-react'
import { api, type GitState } from '../api'
import { useStore } from '../store'
import { timeAgo } from '../lib/format'
import { Section } from './ui'

const useGitStore = create<{ git: GitState | null; refresh: () => Promise<void> }>((set) => ({
  git: null,
  async refresh() {
    try {
      set({ git: await api.git() })
    } catch {
      /* server offline */
    }
  },
}))

let polling = 0
export function useGit() {
  const git = useGitStore((s) => s.git)
  useEffect(() => {
    const { refresh } = useGitStore.getState()
    if (polling++ === 0) refresh()
    const t = setInterval(refresh, 8000)
    return () => {
      polling--
      clearInterval(t)
    }
  }, [])
  return git
}

async function run(action: Parameters<typeof api.gitAction>[0], body?: unknown) {
  try {
    const git = await api.gitAction(action, body)
    useGitStore.setState({ git })
    return true
  } catch (e) {
    useStore.getState().toast({ text: (e as Error).message, tone: 'error' })
    await useGitStore.getState().refresh()
    return false
  }
}

export function SyncPanel() {
  const git = useGit()
  const setSide = useStore((s) => s.setSide)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [remote, setRemote] = useState('')
  const s = git?.status

  const act = async (name: string, action: Parameters<typeof api.gitAction>[0], body?: unknown) => {
    setBusy(name)
    const ok = await run(action, body)
    setBusy(null)
    if (ok && name === 'sync') useStore.getState().toast({ text: 'Synced with your team', tone: 'sync', who: 'Git' })
    return ok
  }

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <div className="ph-row">
          <h3>
            <FolderGit2 size={15} /> Sync with git
          </h3>
          <span className="grow" />
          <button className="icon-btn" onClick={() => setSide(null)}>
            <X size={16} />
          </button>
        </div>
        <p className="hint">Everything runs on your computer. Git is how your team shares plans — no hosting needed. Each step is its own file, so people rarely collide.</p>
      </header>
      <div className="panel-body">
        {!s ? (
          <div className="faint">Checking…</div>
        ) : !s.available ? (
          <div className="callout warn">
            <AlertTriangle size={14} /> Git isn't installed on this computer.
          </div>
        ) : !s.repo ? (
          <Section title="Turn on sync">
            <p className="hint">
              Your plans live in <code>{git.workspace}</code>. Make it a git repo, and optionally connect a remote (GitHub, GitLab…) your team can pull from.
            </p>
            <input className="input" placeholder="git@github.com:you/plans.git (optional)" value={remote} onChange={(e) => setRemote(e.target.value)} />
            <button className="btn primary" disabled={!!busy} onClick={() => act('init', 'init', { remote: remote.trim() || undefined })}>
              <GitBranch size={13} /> {busy ? 'Setting up…' : 'Start tracking with git'}
            </button>
          </Section>
        ) : (
          <>
            <div className="sync-status">
              <div className="ss-row">
                <GitBranch size={13} />
                <b>{s.branch ?? 'main'}</b>
                {s.nested && <span className="faint sm">inside {s.root?.split('/').pop()}</span>}
                <span className="grow" />
                {s.remote ? <span className="faint sm mono">{s.remote.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, '$1')}</span> : <span className="faint sm">no remote</span>}
              </div>
              <div className="ss-stats">
                <Stat icon={CircleDot} label="unsaved changes" value={s.dirty} tone={s.dirty ? 'warn' : ''} />
                <Stat icon={ArrowUp} label="to push" value={s.ahead} tone={s.ahead ? 'info' : ''} />
                <Stat icon={ArrowDown} label="to pull" value={s.behind} tone={s.behind ? 'info' : ''} />
              </div>
              {s.lastSync && <div className="faint sm">Last synced {timeAgo(s.lastSync)}</div>}
            </div>

            {s.lastError && (
              <div className="callout warn">
                <AlertTriangle size={14} />
                <div>
                  {s.lastError}
                  {s.conflict && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn sm" onClick={() => act('sync', 'sync', { strategy: 'mine' })}>
                        Keep mine
                      </button>
                      <button className="btn sm" onClick={() => act('sync', 'sync', { strategy: 'theirs' })}>
                        Keep theirs
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Section title="Sync">
              <input className="input" placeholder="Describe your changes (optional — auto-generated)" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button
                className="btn primary wide"
                disabled={!!busy}
                onClick={async () => {
                  if (!s.remote) {
                    if (await act('commit', 'commit', { message: message || undefined })) useStore.getState().toast({ text: 'Committed locally', tone: 'sync', who: 'Git' })
                  } else await act('sync', 'sync', { message: message || undefined })
                  setMessage('')
                }}
              >
                <RefreshCw size={13} className={busy === 'sync' || s.busy ? 'spin' : ''} />
                {s.remote ? (busy === 'sync' ? 'Syncing…' : 'Sync now — commit, pull, push') : busy ? 'Committing…' : 'Commit changes'}
              </button>
              {s.remote && (
                <div className="row">
                  <button className="btn sm grow" disabled={!!busy} onClick={() => act('commit', 'commit', { message: message || undefined })}>
                    <GitCommitHorizontal size={12} /> Commit
                  </button>
                  <button className="btn sm grow" disabled={!!busy} onClick={() => act('pull', 'pull')}>
                    <ArrowDown size={12} /> Pull
                  </button>
                  <button className="btn sm grow" disabled={!!busy} onClick={() => act('push', 'push')}>
                    <ArrowUp size={12} /> Push
                  </button>
                </div>
              )}
              <label className={`toggle ${s.autoSync ? 'on' : ''}`}>
                <input type="checkbox" checked={s.autoSync} onChange={(e) => run('autosync', { on: e.target.checked })} disabled={!s.remote} />
                <span className="knob" />
                Auto-sync every minute{!s.remote && ' (needs a remote)'}
              </label>
            </Section>

            <Section title={s.remote ? 'Remote' : 'Connect a remote'}>
              <div className="row">
                <input className="input grow" placeholder={s.remote ?? 'git@github.com:team/plans.git'} value={remote} onChange={(e) => setRemote(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <button className="btn sm" disabled={!remote.trim() || !!busy} onClick={async () => (await act('remote', 'remote', { remote: remote.trim() })) && setRemote('')}>
                  {s.remote ? 'Change' : 'Connect'}
                </button>
              </div>
              <p className="hint">Teammates clone the same repo and run Pathways with <code>PATHWAYS_DIR=&lt;clone&gt; npm run dev</code>.</p>
            </Section>

            <Section title="History">
              <ul className="commits">
                {git.log.map((c, i) => (
                  <motion.li key={c.hash} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                    <span className="mono faint">{c.hash}</span>
                    <span className="grow">{c.subject.replace(/^Pathways: /, '')}</span>
                    <span className="faint sm">
                      {c.author} · {timeAgo(c.at)}
                    </span>
                  </motion.li>
                ))}
                {!git.log.length && <li className="faint">No commits yet.</li>}
              </ul>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ArrowUp; label: string; value: number; tone: string }) {
  return (
    <div className={`stat ${tone}`}>
      <Icon size={12} />
      <motion.b key={value} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {value}
      </motion.b>
      <span>{label}</span>
    </div>
  )
}
