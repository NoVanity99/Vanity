import { Play } from 'lucide-react'
import type { Game } from '@shared/types'
import { formatPlaytime, formatRelativeDate } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { useLibrary } from '@/state/library'

/** Wide cards for the most recently played games, shown above the library grid. */
export function RecentShelf({ games, onOpen, onMenu }: { games: Game[]; onOpen: (g: Game) => void; onMenu: (e: React.MouseEvent, g: Game) => void }): React.JSX.Element | null {
  const { launch, sessions } = useLibrary()
  if (games.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">Jump back in</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5">
        {games.map((g, i) => {
          const art = mediaUrl(g.heroPath) ?? mediaUrl(g.coverPath)
          const logo = mediaUrl(g.logoPath)
          const hue = nameHue(g.name)
          const session = sessions[g.id]
          return (
            <div
              key={g.id}
              role="button"
              tabIndex={0}
              aria-label={g.name}
              onClick={() => onOpen(g)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(g)}
              onContextMenu={(e) => onMenu(e, g)}
              style={{ '--i': i } as React.CSSProperties}
              className="animate-card-in group relative aspect-[16/8] cursor-pointer overflow-hidden rounded-2xl bg-surface-2 shadow-xl shadow-black/40 ring-1 ring-white/5 outline-none transition duration-300 ease-out hover:-translate-y-1 hover:shadow-2xl hover:ring-white/20 focus-visible:ring-2 focus-visible:ring-accent"
            >
              {art ? (
                <img
                  src={art}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 26%), hsl(${(hue + 40) % 360} 45% 10%))` }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

              <div className="absolute inset-x-5 bottom-4 flex items-end gap-4">
                <div className="min-w-0 flex-1">
                  {logo ? (
                    <img src={logo} alt={g.name} draggable={false} className="mb-2 max-h-14 max-w-[70%] object-contain object-left drop-shadow-xl" />
                  ) : (
                    <p className="mb-1 truncate text-xl font-bold drop-shadow">{g.name}</p>
                  )}
                  <p className="text-xs text-white/70">
                    {formatRelativeDate(g.lastPlayedAt)} · {formatPlaytime(g.playtimeSeconds)}
                  </p>
                </div>
                <button
                  aria-label={`Play ${g.name}`}
                  disabled={!!session}
                  onClick={(e) => {
                    e.stopPropagation()
                    launch(g.id)
                  }}
                  className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-white/95 px-4 text-sm font-semibold text-black shadow-lg transition hover:scale-105 hover:bg-white disabled:bg-emerald-500 disabled:text-white"
                >
                  {session ? (
                    session === 'running' ? 'Playing' : 'Launching…'
                  ) : (
                    <>
                      <Play className="size-4 fill-current" /> Play
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
