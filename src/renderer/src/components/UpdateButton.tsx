import { useEffect, useState } from 'react'
import { ArrowDownToLine, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { checkForUpdate, onOpenUpdateDialog, openUpdateDialog, pendingCount, useUpdate } from '@/state/update'
import { useToast } from '@/state/toasts'
import { UpdateDialog } from './UpdateDialog'

/** Small round button in the title bar: checks for updates, or shows a red count when one is waiting. */
export function UpdateButton(): React.JSX.Element | null {
  const state = useUpdate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  useEffect(() => onOpenUpdateDialog(() => setOpen(true)), [])

  if (!state || state.mode === 'unsupported') return null
  const count = pendingCount(state)

  const click = async (): Promise<void> => {
    if (count > 0) return setOpen(true)
    const s = await checkForUpdate()
    if (s.available) setOpen(true)
    else if (s.mode === 'release' && s.progress != null) toast(`Downloading v${s.latest} in the background (${s.progress}%)…`)
    else if (s.needsToken) toast('Updates need a GitHub token. Add one in Settings → Updates.', 'error')
    else if (s.error) toast(s.error, 'error')
    else toast(`You're up to date (v${s.current})`)
  }

  const title =
    count > 0
      ? state.mode === 'release'
        ? `Update ready: restart to install v${state.latest}`
        : `Update available: v${state.latest}`
      : state.progress != null
        ? `Downloading v${state.latest} (${state.progress}%)…`
        : state.checking
          ? 'Checking for updates…'
        : `Check for updates (v${state.current}${state.lastChecked ? `, checked ${formatAgo(state.lastChecked)}` : ''})`

  return (
    <>
      <button
        onClick={click}
        title={title}
        aria-label={title}
        className={cn(
          'relative flex size-7 shrink-0 items-center justify-center rounded-full border backdrop-blur transition hover:scale-110 [-webkit-app-region:no-drag]',
          count > 0 ? 'border-red-500/50 bg-red-500/15 text-red-300' : 'border-white/10 bg-black/30 text-muted hover:text-text'
        )}
      >
        {count > 0 ? <ArrowDownToLine className="size-3.5" /> : <RefreshCw className={cn('size-3.5', state.checking && 'animate-spin')} />}
        {count > 0 && (
          <span className="animate-pop-in absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-[0_0_8px_rgb(239_68_68)] ring-2 ring-bg">
            {count}
          </span>
        )}
      </button>
      {open && <UpdateDialog state={state} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Small red "Update software" banner, shown while a new version is waiting. */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdate()
  const [hidden, setHidden] = useState<string | null>(null)
  if (!state?.available || state.applying || hidden === state.latest) return null
  return (
    <div className="animate-rise-in fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center overflow-hidden rounded-full bg-red-600 text-sm font-semibold text-white shadow-2xl shadow-red-900/50 ring-1 ring-red-400/40">
      <button onClick={openUpdateDialog} className="flex items-center gap-2 py-2 pl-4 pr-3 transition hover:bg-red-500">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
        {state.mode === 'release' ? (
          <>
            Update ready
            <span className="font-normal text-white/80">restart to install v{state.latest}</span>
          </>
        ) : (
          <>
            Update software
            <span className="font-normal text-white/80">v{state.latest} is ready</span>
          </>
        )}
      </button>
      <button onClick={() => setHidden(state.latest)} aria-label="Hide until the next update" title="Hide" className="border-l border-white/20 py-2 pl-2 pr-3 transition hover:bg-red-500">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
