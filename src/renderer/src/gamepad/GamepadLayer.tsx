import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useSettings } from '@/state/settings'
import { activate, adjustSlider, closeLayer, moveFocus, openContextMenu, playFocused, scrollTarget } from './focus'
import { GamepadInput, padKind, type Action, type PadKind } from './input'
import { OnScreenKeyboard } from './OnScreenKeyboard'

/** Sidebar tabs, in order, for LB/RB. */
const TABS = ['/library', '/trending', '/store', '/friends', '/recent', '/favorites', '/stats', '/settings', '/account']

const GLYPHS: Record<PadKind, Record<'a' | 'b' | 'x' | 'y', string>> = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y' },
  generic: { a: 'A', b: 'B', x: 'X', y: 'Y' },
  playstation: { a: '✕', b: '○', x: '□', y: '△' }
}
const GLYPH_COLORS: Record<PadKind, Record<'a' | 'b' | 'x' | 'y', string>> = {
  xbox: { a: 'bg-[#3b9b3b]', b: 'bg-[#c53b3b]', x: 'bg-[#2f6fd1]', y: 'bg-[#c9a227]' },
  generic: { a: 'bg-white/20', b: 'bg-white/20', x: 'bg-white/20', y: 'bg-white/20' },
  playstation: { a: 'bg-[#2f6fd1]', b: 'bg-[#c53b3b]', x: 'bg-[#b64fb6]', y: 'bg-[#2fa58a]' }
}

/** Lets components claim controller actions first (e.g. the Steam store's B = back). Return true to consume. */
export type GamepadHandler = (a: Action) => boolean
const handlers: GamepadHandler[] = []
export function useGamepadHandler(handler: GamepadHandler): void {
  useEffect(() => {
    handlers.push(handler)
    return () => {
      const i = handlers.lastIndexOf(handler)
      if (i >= 0) handlers.splice(i, 1)
    }
  }, [handler])
}
/** Right-stick scrolling claimed by a component (e.g. inside the Steam store page). */
let scrollOverride: ((dy: number) => boolean) | null = null
export function setGamepadScroll(fn: ((dy: number) => boolean) | null): void {
  scrollOverride = fn
}

function Hint({ glyph, color, children }: { glyph: string; color?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black text-white ring-1 ring-white/20', color ?? 'bg-white/15')}>{glyph}</span>
      {children}
    </span>
  )
}

/**
 * Controller support for the whole app: polls the Gamepad API, moves focus
 * spatially, maps buttons to actions, shows button hints, and opens an
 * on-screen keyboard for text fields. Mouse movement switches back to mouse mode.
 */
export function GamepadLayer(): React.JSX.Element | null {
  const settings = useSettings()
  const enabled = settings?.controllerEnabled !== false
  const navigate = useNavigate()
  const location = useLocation()
  const [kind, setKind] = useState<PadKind | null>(null)
  const [active, setActive] = useState(false)
  const [osk, setOsk] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const oskHandler = useRef<GamepadHandler | null>(null)
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname

  const enterControllerMode = useCallback(() => {
    if (!document.documentElement.classList.contains('gamepad-mode')) {
      document.documentElement.classList.add('gamepad-mode')
      setActive(true)
    }
  }, [])

  // Any mouse use leaves controller mode.
  useEffect(() => {
    const leave = (): void => {
      if (document.documentElement.classList.contains('gamepad-mode')) {
        document.documentElement.classList.remove('gamepad-mode')
        setActive(false)
      }
    }
    window.addEventListener('mousemove', leave)
    window.addEventListener('mousedown', leave)
    return () => {
      window.removeEventListener('mousemove', leave)
      window.removeEventListener('mousedown', leave)
    }
  }, [])

  const onAction = useCallback(
    (a: Action) => {
      enterControllerMode()
      if (oskHandler.current?.(a)) return
      for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i](a)) return
      switch (a) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          if (!adjustSlider(a)) moveFocus(a)
          break
        case 'confirm': {
          if (activate() === 'text') {
            const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement
            setOsk(el)
          }
          break
        }
        case 'back':
          if (!closeLayer()) {
            if (TABS.includes(pathRef.current)) {
              // At a top-level tab: jump focus to the sidebar.
              document.querySelector<HTMLElement>(`aside a[href="#${pathRef.current}"]`)?.focus()
            } else navigate(-1)
          }
          break
        case 'options':
          openContextMenu()
          break
        case 'search': {
          const search = document.querySelector<HTMLInputElement>('main input[placeholder*="Search" i], main input[placeholder*="Add a friend" i]')
          if (search) {
            search.focus()
            setOsk(search)
          }
          break
        }
        case 'prevTab':
        case 'nextTab': {
          const i = TABS.indexOf(pathRef.current)
          const next = TABS[(Math.max(0, i) + (a === 'nextTab' ? 1 : TABS.length - 1)) % TABS.length]
          navigate(next)
          setTimeout(() => moveFocus('down'), 350)
          break
        }
        case 'pageUp':
        case 'pageDown': {
          const el = scrollTarget()
          el?.scrollBy({ top: (a === 'pageDown' ? 1 : -1) * el.clientHeight * 0.8, behavior: 'smooth' })
          break
        }
        case 'play':
          playFocused()
          break
        case 'view':
          // Jump to the sidebar's current tab.
          document.querySelector<HTMLElement>(`aside a[href="#${pathRef.current}"]`)?.focus() ??
            document.querySelector<HTMLElement>('aside a')?.focus()
          break
      }
    },
    [enterControllerMode, navigate]
  )

  // Poll the controller ~60 times a second. A timer rather than requestAnimationFrame,
  // so quick taps aren't missed when frames are slow or throttled.
  useEffect(() => {
    if (!enabled) return
    const input = new GamepadInput(onAction, (_dx, dy) => {
      enterControllerMode()
      if (scrollOverride?.(dy * 22)) return
      scrollTarget()?.scrollBy({ top: dy * 22 })
    })
    let lastKind: PadKind | null = null
    const poll = (): void => {
      const pads = navigator.getGamepads?.() ?? []
      const pad = [...pads].find((p) => p && p.connected) ?? null
      const id = input.update(pad, performance.now())
      const k = id ? padKind(id) : null
      if (k !== lastKind) {
        lastKind = k
        setKind(k)
      }
    }
    const timer = setInterval(poll, 16)
    return () => clearInterval(timer)
  }, [enabled, onAction, enterControllerMode])

  // Expose the connected controller to Settings.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('vanity:controller', { detail: kind }))
  }, [kind])

  const subscribeOsk = useCallback((h: GamepadHandler) => {
    oskHandler.current = h
    return () => {
      if (oskHandler.current === h) oskHandler.current = null
    }
  }, [])

  const closeOsk = useCallback(
    (submit: boolean) => {
      const el = osk
      setOsk(null)
      oskHandler.current = null
      if (!el) return
      el.focus()
      if (submit) {
        // Submit the field's form (search, sign-in, add friend…) as Enter would.
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        const form = el.closest('form')
        if (form) form.requestSubmit()
      }
    },
    [osk]
  )

  if (!enabled) return null
  const g = GLYPHS[kind ?? 'xbox']
  const c = GLYPH_COLORS[kind ?? 'xbox']

  return (
    <>
      {osk && <OnScreenKeyboard target={osk} onClose={closeOsk} subscribe={subscribeOsk} />}
      {active && kind && !osk && (
        <div className="animate-[toast-in_220ms_ease-out] pointer-events-none fixed bottom-4 left-1/2 z-[65] flex -translate-x-1/2 items-center gap-5 rounded-full border border-white/10 bg-black/70 px-5 py-2 text-xs text-white/85 shadow-2xl backdrop-blur-xl">
          <Hint glyph={g.a} color={c.a}>Select</Hint>
          <Hint glyph={g.b} color={c.b}>Back</Hint>
          <Hint glyph={g.x} color={c.x}>Options</Hint>
          <Hint glyph={g.y} color={c.y}>Search</Hint>
          <Hint glyph="LB RB">Tabs</Hint>
          <Hint glyph="☰">Play</Hint>
        </div>
      )}
    </>
  )
}
