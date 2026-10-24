import { useState } from 'react'
import { History } from 'lucide-react'
import type { GameSession } from '@shared/types'
import { formatPlaytime, formatRelativeDate } from '@/lib/format'
import { Section } from './parts'

const STEP = 8
const time = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function SessionHistory({ history, delay }: { history: GameSession[]; delay?: number }): React.JSX.Element | null {
  const [shown, setShown] = useState(STEP)
  if (history.length === 0) return null
  const max = Math.max(...history.map((s) => s.seconds))
  return (
    <Section icon={History} title="Session history" delay={delay} action={<span className="text-xs text-muted">{history.length} recorded</span>}>
      <ul className="divide-y divide-white/5">
        {history.slice(0, shown).map((s) => (
          <li key={s.startedAt} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-4 py-2.5 text-sm">
            <span>
              <span className="block font-medium">{formatRelativeDate(s.startedAt)}</span>
              <span className="block text-xs text-muted">
                {time(s.startedAt)}
                {s.endedAt ? ` – ${time(s.endedAt)}` : ''}
              </span>
            </span>
            <span className="h-2 overflow-hidden rounded-r-[4px] bg-white/5">
              <span className="block h-full rounded-r-[4px] bg-accent/80" style={{ width: `${(s.seconds / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted">{formatPlaytime(s.seconds)}</span>
          </li>
        ))}
      </ul>
      {history.length > shown && (
        <button className="mt-3 text-sm font-medium text-accent hover:underline" onClick={() => setShown((n) => n + STEP * 2)}>
          Show more ({history.length - shown} older)
        </button>
      )}
    </Section>
  )
}
