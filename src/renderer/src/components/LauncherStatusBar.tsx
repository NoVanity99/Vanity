import { useEffect, useState } from 'react'
import { STORE_LABELS, type LauncherStatus, type StoreLauncher } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'

const SHORT: Record<StoreLauncher, string> = {
  steam: 'Steam',
  epic: 'Epic',
  ea: 'EA',
  ubisoft: 'Ubisoft',
  battlenet: 'Battle.net',
  gog: 'GOG',
  microsoft: 'MS Store'
}

function tooltip(s: LauncherStatus): string {
  const state = s.state === 'online' ? 'online' : s.state === 'offline' ? 'unreachable' : 'checking…'
  const detail = s.detail ? ` (${s.detail})` : ''
  const when = s.checkedAt ? `, checked ${formatAgo(s.checkedAt)}` : ''
  return `${STORE_LABELS[s.launcher]}: ${state}${detail}${when}. Click to check again.`
}

/** Tiny online/offline indicators for each launcher's services, shown above every page. */
export function LauncherStatusBar(): React.JSX.Element {
  const [statuses, setStatuses] = useState<LauncherStatus[]>([])
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.vanity.status.get().then(setStatuses, () => {})
    return window.vanity.status.onUpdate(setStatuses)
  }, [])

  const recheck = (): void => {
    setChecking(true)
    window.vanity.status
      .refresh()
      .then(setStatuses, () => {})
      .finally(() => setChecking(false))
  }

  return (
    <div className={cn('flex items-center gap-3.5 text-[11px] font-medium transition-opacity', checking && 'opacity-60')} aria-label="Launcher status">
      {statuses.map((s) => (
        <button
          key={s.launcher}
          title={tooltip(s)}
          onClick={recheck}
          className={cn(
            'flex items-center gap-1.5 [-webkit-app-region:no-drag]',
            s.state === 'online' ? 'text-emerald-400/90' : s.state === 'offline' ? 'text-red-400/90' : 'text-muted/70'
          )}
        >
          <span className="relative flex size-1.5">
            {s.state === 'offline' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400/60" />}
            <span
              className={cn(
                'relative inline-flex size-1.5 rounded-full',
                s.state === 'online' ? 'bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153/0.8)]' : s.state === 'offline' ? 'bg-red-400 shadow-[0_0_6px_rgb(248_113_113/0.8)]' : 'bg-muted/60'
              )}
            />
          </span>
          {SHORT[s.launcher]}
        </button>
      ))}
    </div>
  )
}
