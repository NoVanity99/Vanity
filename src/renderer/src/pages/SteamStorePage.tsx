import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Home, RotateCw, ShieldCheck, WifiOff } from 'lucide-react'
import type { WebviewTag } from 'electron'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'

const HOME = 'https://store.steampowered.com/'
// The store behaves best with a normal Chrome user agent (without Electron/Vanity tokens).
const USER_AGENT = navigator.userAgent.replace(/\s(Electron|vanity)\/\S+/gi, '')

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}

/** Browse the Steam store inside Vanity. Sign-in persists between sessions. */
export function SteamStorePage(): React.JSX.Element {
  const view = useRef<WebviewTag | null>(null)
  const [url, setUrl] = useState(HOME)
  const [loading, setLoading] = useState(true)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const el = view.current
    if (!el) return
    const sync = (): void => {
      try {
        setNav({ back: el.canGoBack(), forward: el.canGoForward() })
        setUrl(el.getURL())
      } catch {
        // Not attached yet.
      }
    }
    const onStart = (): void => {
      setLoading(true)
      setFailed(null)
    }
    const onStop = (): void => {
      setLoading(false)
      sync()
    }
    const onFail = (e: Event): void => {
      const { errorCode, errorDescription, isMainFrame } = e as unknown as { errorCode: number; errorDescription: string; isMainFrame: boolean }
      // -3 is "aborted" (e.g. a redirect we blocked); not worth an error screen.
      if (isMainFrame && errorCode !== -3) {
        setFailed(`Check your internet connection and try again.${errorDescription ? ` (${errorDescription})` : ''}`)
      }
      setLoading(false)
    }
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', sync)
    el.addEventListener('did-navigate-in-page', sync)
    el.addEventListener('did-fail-load', onFail)
    return () => {
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-navigate', sync)
      el.removeEventListener('did-navigate-in-page', sync)
      el.removeEventListener('did-fail-load', onFail)
    }
  }, [])

  const go = (action: 'back' | 'forward' | 'reload' | 'home'): void => {
    const el = view.current
    if (!el) return
    if (action === 'back') el.goBack()
    else if (action === 'forward') el.goForward()
    else if (action === 'reload') el.reload()
    else void el.loadURL(HOME)
  }

  const navButton = 'flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-white/8 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full flex-col pt-9">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/5 px-4 pb-2">
        <button className={navButton} onClick={() => go('back')} disabled={!nav.back} title="Back">
          <ArrowLeft className="size-4" />
        </button>
        <button className={navButton} onClick={() => go('forward')} disabled={!nav.forward} title="Forward">
          <ArrowRight className="size-4" />
        </button>
        <button className={navButton} onClick={() => go('reload')} title="Reload">
          <RotateCw className={cn('size-4', loading && 'animate-spin')} />
        </button>
        <button className={navButton} onClick={() => go('home')} title="Store home">
          <Home className="size-4" />
        </button>
        <div className="mx-2 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface-2 px-3 text-xs text-muted ring-1 ring-border">
          <ShieldCheck className="size-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">{shortUrl(url)}</span>
        </div>
        <button
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted transition hover:bg-white/8 hover:text-text"
          title="Open this page in the Steam app"
          onClick={() => void window.open(`steam://openurl/${url}`)}
        >
          <ExternalLink className="size-3.5" /> Open in Steam
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* Thin loading bar */}
        <div className={cn('absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity', loading ? 'opacity-100' : 'opacity-0')}>
          <div className="h-full w-1/3 bg-accent" style={{ animation: 'store-load 1.2s ease-in-out infinite' }} />
        </div>
        <webview ref={view as never} src={HOME} partition="persist:steam-store" useragent={USER_AGENT} className="size-full" />
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-border">
              <WifiOff className="size-7 text-muted" />
            </div>
            <h2 className="text-lg font-semibold">Couldn't load the Steam store</h2>
            <p className="mt-1 max-w-md text-sm text-muted">{failed}</p>
            <Button className="mt-6" variant="primary" onClick={() => go('reload')}>
              <RotateCw className="size-4" /> Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
