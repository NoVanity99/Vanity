import { useNavigate } from 'react-router-dom'
import { Check, Shapes } from 'lucide-react'
import type { GameDetails } from '@shared/types'
import { nameHue } from '@/lib/media'
import { Section } from './parts'

export function SimilarGames({ games, delay }: { games: GameDetails['similar']; delay?: number }): React.JSX.Element | null {
  const navigate = useNavigate()
  if (games.length === 0) return null
  const owned = games.filter((g) => g.libraryId !== null).length
  return (
    <Section icon={Shapes} title="If you like this" delay={delay} action={owned > 0 && <span className="text-xs text-muted">{owned} already in your library</span>}>
      <ul className="grid grid-cols-3 gap-4 md:grid-cols-5">
        {games.map((g, i) => {
          const hue = nameHue(g.name)
          const body = (
            <>
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl ring-1 ring-white/5 transition group-hover:-translate-y-1 group-hover:ring-white/25" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 24%), hsl(${(hue + 40) % 360} 40% 10%))` }}>
                {g.coverUrl && <img src={g.coverUrl} alt="" loading="lazy" className="size-full object-cover" draggable={false} />}
                {g.libraryId !== null && (
                  <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                    <Check className="size-3" /> Owned
                  </span>
                )}
              </div>
              <p className="mt-2 truncate text-xs font-medium">{g.name}</p>
            </>
          )
          return (
            <li key={g.igdbId} className="animate-card-in" style={{ '--i': i } as React.CSSProperties}>
              {g.libraryId !== null ? (
                <button className="group w-full text-left" onClick={() => navigate(`/game/${g.libraryId}`)} title={`Open ${g.name}`}>
                  {body}
                </button>
              ) : (
                <div className="group" title={g.name}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
