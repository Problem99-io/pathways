export const fmtDays = (d: number) => {
  if (!isFinite(d)) return '—'
  if (d < 1 && d > 0) return '<1d'
  if (d < 60) return `${Math.round(d)}d`
  if (d < 365) return `${Math.round(d / 7)}w`
  return `${(d / 365).toFixed(1)}y`
}

export const fmtPct = (v: number) => `${Math.round(v * 100)}%`

export const fmtMoney = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `$${Math.round(v)}`

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '—'

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`
  return fmtDate(iso)
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

export const STATUS_LABEL = {
  todo: 'To do',
  in_progress: 'Doing',
  done: 'Done',
  blocked: 'Blocked',
  skipped: 'Skipped',
} as const

export const KIND_LABEL = {
  step: 'Step',
  milestone: 'Milestone',
  recurring: 'Recurring',
  decision: 'Decision',
  research: 'Research',
} as const
