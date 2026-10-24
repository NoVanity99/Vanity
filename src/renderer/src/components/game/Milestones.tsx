import { Award, Lock } from 'lucide-react'
import type { Milestone } from '@/lib/playtime'
import { cn } from '@/lib/cn'
import { Section } from './parts'

export function Milestones({ list, delay }: { list: Milestone[]; delay?: number }): React.JSX.Element {
  const unlocked = list.filter((m) => m.unlocked).length
  return (
    <Section
      icon={Award}
      title="Milestones"
      delay={delay}
      action={
        <span className="text-xs tabular-nums text-muted">
          {unlocked} of {list.length} unlocked
        </span>
      }
    >
      <ul className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
        {list.map((m, i) => (
          <li
            key={m.id}
            style={{ '--i': i } as React.CSSProperties}
            title={m.description}
            className={cn(
              'animate-card-in relative overflow-hidden rounded-xl p-3.5 ring-1',
              m.unlocked ? 'bg-gradient-to-br from-accent/20 to-accent-2/10 ring-accent/30' : 'bg-white/[0.02] ring-white/5'
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg',
                  m.unlocked ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'bg-white/5 text-muted'
                )}
              >
                {m.unlocked ? <Award className="size-4" /> : <Lock className="size-3.5" />}
              </span>
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-semibold', !m.unlocked && 'text-text/60')}>{m.title}</p>
                <p className="line-clamp-2 text-[11px] leading-snug text-muted">{m.description}</p>
              </div>
            </div>
            {!m.unlocked && m.progress !== null && m.progress > 0 && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5" aria-label={`${Math.round(m.progress * 100)}% there`}>
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${m.progress * 100}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}
