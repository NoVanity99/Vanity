import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, Shapes, ShoppingCart } from 'lucide-react'
import type { GameDetails, GameStores, StoreLauncher } from '@shared/types'
import { LauncherPicker } from '@/components/LauncherPicker'
import { nameHue } from '@/lib/media'
import { useToast } from '@/state/toasts'
import { Section } from './parts'

type Similar = GameDetails['similar'][number]

/**
 * "If you like this": games like the one you're looking at. One you own opens its page; one
 * you don't lets you pick a store it is sold on and opens it there, so you can buy it.
 */
export function SimilarGames({ games, delay }: { games: GameDetails['similar']; delay?: number }): React.JSX.Element | null {
  const navigate = useNavigate()
  const toast = useToast()
  const [installed, setInstalled] = useState<Partial<Record<StoreLauncher, boolean>>>({})
  // The game whose stores are being looked up, and the one whose stores are being chosen from.
  const [finding, setFinding] = useState<number | null>(null)
  const [picking, setPicking] = useState<{ game: Similar; found: GameStores } | null>(null)

  useEffect(() => {
    window.vanity.trending.installed().then(setInstalled, () => {})
  }, [])

  if (games.length === 0) return null
  const owned = games.filter((g) => g.libraryId !== null).length

  const open = async (game: Similar, launcher: StoreLauncher, exact: boolean): Promise<void> => {
    setPicking(null)
    const res = await window.vanity.trending.open(game.igdbId, launcher).catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Could not open the store.', data: undefined }))
    if (res.error !== undefined) toast(res.error, 'error')
    else if (!exact) toast(`Vanity doesn't know ${game.name}'s store page, so it searched Steam for it in your browser`)
    else if (res.data === 'browser') toast('Opened the store page in your browser')
  }

  const shop = async (game: Similar): Promise<void> => {
    if (finding !== null) return
    setFinding(game.igdbId)
    const res = await window.vanity.trending.stores(game.igdbId, game.name).catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Could not look up the stores.', data: undefined }))
    setFinding(null)
    if (res.error !== undefined) return toast(res.error, 'error')
    // The stores it is sold on are known: choose one. Otherwise there is only the Steam search to open.
    if (res.data.exact) setPicking({ game, found: res.data })
    else void open(game, res.data.stores[0].launcher, false)
  }

  return (
    <Section icon={Shapes} title="If you like this" delay={delay} action={owned > 0 && <span className="text-xs text-muted">{owned} already in your library</span>}>
      <ul className="grid grid-cols-3 gap-4 md:grid-cols-5">
        {games.map((g, i) => {
          const hue = nameHue(g.name)
          const mine = g.libraryId !== null
          const busy = finding === g.igdbId
          return (
            <li key={g.igdbId} className="animate-card-in" style={{ '--i': i } as React.CSSProperties}>
              <button
                className="group w-full text-left disabled:cursor-wait"
                data-similar={mine ? 'owned' : 'shop'}
                disabled={finding !== null}
                onClick={() => (mine ? navigate(`/game/${g.libraryId}`) : void shop(g))}
                title={mine ? `Open ${g.name}` : `See where to buy ${g.name}`}
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl ring-1 ring-white/5 transition group-hover:-translate-y-1 group-hover:ring-white/25" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 24%), hsl(${(hue + 40) % 360} 40% 10%))` }}>
                  {g.coverUrl && <img src={g.coverUrl} alt="" loading="lazy" className="size-full object-cover" draggable={false} />}
                  {mine ? (
                    <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                      <Check className="size-3" /> Owned
                    </span>
                  ) : (
                    // Shows what a click does: on hover (or while it is looking the stores up).
                    <span className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-6 text-[11px] font-semibold text-white transition ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShoppingCart className="size-3.5" />}
                      {busy ? 'Finding stores…' : 'Where to buy'}
                    </span>
                  )}
                </div>
                <p className="mt-2 truncate text-xs font-medium">{g.name}</p>
              </button>
            </li>
          )
        })}
      </ul>
      {picking && (
        <LauncherPicker
          game={{ title: picking.found.title || picking.game.name, stores: picking.found.stores }}
          installed={installed}
          onPick={(l) => void open(picking.game, l, picking.found.exact)}
          onClose={() => setPicking(null)}
        />
      )}
    </Section>
  )
}
