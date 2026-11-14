import { App } from '@capacitor/app'

const HOLD_MS = 480
const MOVE_PX = 12

/**
 * Touch and hold opens the same menu a right-click does on desktop.
 * (Android's own long-press behaviour, such as selecting text, is turned off for it.)
 */
export function installLongPress(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number } | null = null
  let swallowClick = false

  const cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    start = null
  }

  document.addEventListener(
    'touchstart',
    (e) => {
      cancel()
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const target = e.target as Element | null
      // Leave text fields alone: holding there is for the cursor and paste.
      if (!target || target.closest('input, textarea, select, [contenteditable]')) return
      start = { x: t.clientX, y: t.clientY }
      timer = setTimeout(() => {
        timer = null
        if (!start) return
        swallowClick = true
        setTimeout(() => (swallowClick = false), 700)
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, view: window }))
      }, HOLD_MS)
    },
    { passive: true }
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0]
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_PX) cancel()
    },
    { passive: true }
  )
  document.addEventListener('touchend', cancel, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })
  // The browser's own long-press menu event would open the menu a second time.
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.isTrusted) return
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true
  )
  // Lifting the finger after a hold must not also count as a tap on the game.
  document.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true
  )
}

/**
 * Android's Back button: closes an open menu or dialog first, then goes back a page,
 * and leaves Vanity only from a top-level screen.
 */
export function installBackButton(): void {
  void App.addListener('backButton', ({ canGoBack }) => {
    const layers = document.querySelectorAll('[role="menu"], [role="dialog"]')
    if (layers.length > 0) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (canGoBack && !/^#\/(library)?$/.test(location.hash)) history.back()
    else void App.minimizeApp()
  }).catch(() => {
    // Not running inside the Android app (e.g. tests in a browser).
  })
}
