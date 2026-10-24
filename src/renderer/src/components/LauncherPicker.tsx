import { ChevronRight, ExternalLink } from 'lucide-react'
import { STORE_LABELS, type StoreLauncher, type StoreLink, type TrendingGame } from '@shared/types'
import { cn } from '@/lib/cn'
import { Dialog } from './Dialog'
import { StoreIcon } from './StoreIcon'

const ORDER: StoreLauncher[] = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'battlenet', 'microsoft']

function subtitle(link: StoreLink, installed: boolean): string {
  if (!installed) return 'Not installed — open in browser'
  return link.deepLink ? 'Installed — opens in the launcher' : 'Installed — opens the store page in your browser'
}

interface Props {
  game: Pick<TrendingGame, 'title' | 'stores'>
  installed: Partial<Record<StoreLauncher, boolean>>
  onPick: (launcher: StoreLauncher) => void
  onClose: () => void
}

/** "Choose a launcher": every store the game is on, installed launchers first. */
export function LauncherPicker({ game, installed, onPick, onClose }: Props): React.JSX.Element {
  const stores = [...game.stores].sort(
    (a, b) => Number(!!installed[b.launcher]) - Number(!!installed[a.launcher]) || ORDER.indexOf(a.launcher) - ORDER.indexOf(b.launcher)
  )

  return (
    <Dialog title="Choose a launcher" description={game.title} onClose={onClose}>
      <ul className="space-y-1 p-3">
        {stores.map((s) => {
          const isInstalled = !!installed[s.launcher]
          return (
            <li key={s.launcher}>
              <button
                onClick={() => onPick(s.launcher)}
                className="group flex w-full items-center gap-4 rounded-xl p-3 text-left transition hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
              >
                <StoreIcon launcher={s.launcher} size="lg" className={cn(!isInstalled && 'opacity-70')} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{STORE_LABELS[s.launcher]}</span>
                  <span className={cn('block text-xs', isInstalled ? 'text-emerald-400' : 'text-muted')}>{subtitle(s, isInstalled)}</span>
                </span>
                {isInstalled && s.deepLink ? (
                  <ChevronRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-text" />
                ) : (
                  <ExternalLink className="size-4 text-muted transition group-hover:text-text" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
