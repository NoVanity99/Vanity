import { PLAY_STATUSES, type PlayStatus } from '@shared/types'

/** Text and ring colour for journal status pills (always shown with their label). */
export const STATUS_TONE: Record<PlayStatus, string> = {
  backlog: 'text-sky-300 ring-sky-400/30',
  playing: 'text-emerald-300 ring-emerald-400/30',
  beaten: 'text-violet-300 ring-violet-400/30',
  completed: 'text-amber-300 ring-amber-400/30',
  dropped: 'text-muted ring-white/15'
}

const BG: Record<PlayStatus, string> = {
  backlog: 'bg-sky-500/15',
  playing: 'bg-emerald-500/15',
  beaten: 'bg-violet-500/15',
  completed: 'bg-amber-500/15',
  dropped: 'bg-white/5'
}

/** Tone plus a matching tinted background. */
export const STATUS_STYLES = Object.fromEntries(PLAY_STATUSES.map((s) => [s, `${BG[s]} ${STATUS_TONE[s]}`])) as Record<PlayStatus, string>
