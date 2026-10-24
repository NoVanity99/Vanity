import { ExternalLink, Newspaper } from 'lucide-react'
import type { GameDetails } from '@shared/types'
import { formatRelativeDate } from '@/lib/format'
import { Section } from './parts'

export function NewsSection({ news, delay }: { news: GameDetails['news']; delay?: number }): React.JSX.Element | null {
  if (news.length === 0) return null
  return (
    <Section icon={Newspaper} title="Latest news" delay={delay}>
      <ul className="grid gap-3 md:grid-cols-2">
        {news.map((n) => (
          <li key={n.url}>
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="group flex h-full flex-col rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5 transition hover:-translate-y-0.5 hover:bg-white/[0.05] hover:ring-white/20"
            >
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {n.source} · {formatRelativeDate(n.date)}
                <ExternalLink className="ml-auto size-3.5 opacity-0 transition group-hover:opacity-100" />
              </span>
              <span className="mt-2 line-clamp-2 font-semibold leading-snug transition-colors group-hover:text-accent">{n.title}</span>
              {n.excerpt && <span className="mt-1.5 line-clamp-3 text-sm text-muted">{n.excerpt}</span>}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}
