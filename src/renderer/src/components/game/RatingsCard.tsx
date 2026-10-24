import { ExternalLink, Star } from 'lucide-react'
import type { GameDetails } from '@shared/types'
import { formatCompact } from '@/lib/format'
import { Ring, Section } from './parts'

export function RatingsCard({ ratings, delay }: { ratings: GameDetails['ratings']; delay?: number }): React.JSX.Element | null {
  const { critics, players, metacritic, steam } = ratings
  const steamPct = steam && steam.total > 0 ? Math.round((steam.positive / steam.total) * 100) : null
  if (!critics && !players && !metacritic && steamPct === null) return null
  return (
    <Section icon={Star} title="Ratings" delay={delay}>
      <div className="flex flex-wrap justify-around gap-5">
        {metacritic && <Ring score={metacritic.score} label="Metacritic" sub="Metascore" />}
        {critics && <Ring score={critics.score} label="Critics" sub={`${critics.count} reviews`} />}
        {players && <Ring score={players.score} label="IGDB players" sub={`${formatCompact(players.count)} ratings`} />}
        {steamPct !== null && <Ring score={steamPct} label="Steam" sub={`${formatCompact(steam!.total)} reviews`} />}
      </div>
      {steam && (
        <p className="mt-5 rounded-xl bg-white/[0.03] px-3 py-2 text-center text-sm ring-1 ring-white/5">
          <span className="font-semibold">{steam.label}</span>
          <span className="text-muted"> · {steamPct}% of {steam.total.toLocaleString()} Steam reviews are positive</span>
        </p>
      )}
      {metacritic?.url && (
        <a href={metacritic.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted hover:text-text">
          Read reviews on Metacritic <ExternalLink className="size-3" />
        </a>
      )}
    </Section>
  )
}
