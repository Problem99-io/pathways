import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, FileText, ImagePlus, Link2, StickyNote, X } from 'lucide-react'
import { uid } from '../../shared/ops'
import type { Attachment } from '../../shared/types'
import { api } from '../api'
import { myName, useStore } from '../store'
import { softSpring } from './ui'

/** References for a step (target = step id) or the whole pathway (target = null). */
export function Attachments({ target, items }: { target: string | null; items: Attachment[] }) {
  const doc = useStore((s) => s.doc)!
  const dispatch = useStore((s) => s.dispatch)
  const user = useStore((s) => myName(s))
  const [mode, setMode] = useState<null | 'link' | 'note'>(null)
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const add = (a: Omit<Attachment, 'id' | 'addedAt' | 'addedBy'>) =>
    dispatch([{ t: 'attachment.add', target, attachment: { ...a, id: uid(), addedAt: new Date().toISOString(), addedBy: user } }])

  const upload = async (files: FileList | File[]) => {
    setBusy(true)
    try {
      for (const f of Array.from(files)) {
        const { url } = await api.upload(doc.id, f)
        await add({ type: f.type.startsWith('image/') ? 'image' : 'file', title: f.name || 'Pasted image', url })
      }
    } catch (e) {
      useStore.getState().toast({ text: (e as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    const v = val.trim()
    if (!v) return
    setBusy(true)
    if (mode === 'link') {
      const url = /^https?:\/\//.test(v) ? v : `https://${v}`
      const meta = await api.unfurl(url).catch(() => ({}) as { title?: string; description?: string; image?: string })
      const isImg = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)
      await add({ type: isImg ? 'image' : 'link', title: meta.title || new URL(url).hostname, url, text: meta.description, image: meta.image })
    } else {
      const [first, ...rest] = v.split('\n')
      await add({ type: 'note', title: first.slice(0, 80), text: rest.length ? rest.join('\n') : v.length > 80 ? v : undefined })
    }
    setVal('')
    setMode(null)
    setBusy(false)
  }

  return (
    <div
      className={`attachments ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files)
        else {
          const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
          if (url) {
            setMode('link')
            setVal(url)
          }
        }
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files]
        if (files.length) {
          e.preventDefault()
          upload(files)
        }
      }}
    >
      <div className="att-grid">
        <AnimatePresence initial={false}>
          {items.map((a) => (
            <motion.div key={a.id} className={`att att-${a.type}`} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={softSpring}>
              {a.type === 'image' && a.url && (
                <button className="att-img" onClick={() => setPreview(a.url!)}>
                  <img src={a.url} alt={a.title} loading="lazy" />
                </button>
              )}
              {a.type === 'link' && (
                <a className="att-link" href={a.url} target="_blank" rel="noreferrer">
                  {a.image && <img src={a.image} alt="" loading="lazy" onError={(e) => ((e.target as HTMLElement).style.display = 'none')} />}
                  <div>
                    <div className="att-title">
                      <Link2 size={11} /> {a.title}
                    </div>
                    {a.text && <div className="att-text">{a.text}</div>}
                    <div className="att-host">
                      {safeHost(a.url)} <ExternalLink size={9} />
                    </div>
                  </div>
                </a>
              )}
              {a.type === 'note' && (
                <div className="att-note">
                  <div className="att-title">
                    <StickyNote size={11} /> {a.title}
                  </div>
                  {a.text && <div className="att-text pre">{a.text}</div>}
                </div>
              )}
              {a.type === 'file' && (
                <a className="att-note" href={a.url} target="_blank" rel="noreferrer">
                  <div className="att-title">
                    <FileText size={11} /> {a.title}
                  </div>
                </a>
              )}
              {a.addedBy && <div className="att-by">{a.addedBy}</div>}
              <button className="att-x" title="Remove" onClick={() => dispatch([{ t: 'attachment.delete', target, id: a.id }])}>
                <X size={11} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {mode ? (
          <motion.div key="input" className="att-input" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {mode === 'link' ? (
              <input autoFocus placeholder="Paste a link…" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && submit(), e.key === 'Escape' && setMode(null))} />
            ) : (
              <textarea autoFocus rows={3} placeholder="Write a note, finding or quote… (⌘↵ to save)" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit(), e.key === 'Escape' && setMode(null))} />
            )}
            <div className="row end">
              <button className="btn ghost xs" onClick={() => setMode(null)}>
                Cancel
              </button>
              <button className="btn primary xs" disabled={busy} onClick={submit}>
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="btns" className="att-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="btn ghost xs" onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImagePlus size={12} /> {busy ? 'Uploading…' : 'Image / file'}
            </button>
            <button className="btn ghost xs" onClick={() => setMode('link')}>
              <Link2 size={12} /> Link
            </button>
            <button className="btn ghost xs" onClick={() => setMode('note')}>
              <StickyNote size={12} /> Note
            </button>
            <span className="att-hint">or drop / paste here</span>
          </motion.div>
        )}
      </AnimatePresence>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />

      <AnimatePresence>
        {preview && (
          <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreview(null)}>
            <motion.img src={preview} initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={softSpring} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function safeHost(url?: string) {
  try {
    return new URL(url!).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
