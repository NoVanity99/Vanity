import { pickNext, type Box, type Direction } from './spatial'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** Where controller navigation is allowed right now: the topmost menu or dialog, else the whole app. */
export function activeScope(): ParentNode {
  const menus = document.querySelectorAll<HTMLElement>('[role="menu"]')
  if (menus.length) return menus[menus.length - 1]
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]')
  if (dialogs.length) return dialogs[dialogs.length - 1]
  return document
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"], [inert]')) return false
  if ((el as HTMLButtonElement).disabled) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  // On screen (horizontally) and not clipped away.
  if (r.right < 0 || r.left > window.innerWidth) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
}

/** Focusable elements in the active scope. Nested focusables inside another (e.g. a Play button inside a card) are skipped. */
export function focusables(scope: ParentNode = activeScope()): HTMLElement[] {
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el) && other.getAttribute('role') === 'button'))
}

const toBox = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

/** Moves focus to the nearest element in `dir`. With nothing focused, focuses the best starting point. */
export function moveFocus(dir: Direction): void {
  const scope = activeScope()
  const items = focusables(scope)
  if (!items.length) return
  const current = document.activeElement as HTMLElement | null
  if (!current || current === document.body || !items.includes(current)) {
    // Start in the main content (first item), or inside the open dialog/menu.
    const main = items.find((el) => el.closest('main') && !el.closest('[aria-label="Launcher status"], [aria-label="Music player"]'))
    focusEl(main ?? items[0])
    return
  }
  const others = items.filter((el) => el !== current)
  const i = pickNext(toBox(current), others.map(toBox), dir)
  if (i >= 0) focusEl(others[i])
}

const setNativeValue = (el: HTMLInputElement | HTMLSelectElement, value: string): void => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Left/right on a slider changes its value instead of moving focus. Returns true if handled. */
export function adjustSlider(dir: Direction): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLInputElement) || el.type !== 'range' || (dir !== 'left' && dir !== 'right')) return false
  const step = Number(el.step) || 1
  const min = Number(el.min) || 0
  const max = Number(el.max) || 100
  const span = max - min
  // Move in roughly 5% steps so it doesn't take forever.
  const delta = Math.max(step, Math.round(span / 20 / step) * step) * (dir === 'right' ? 1 : -1)
  setNativeValue(el, String(Math.min(max, Math.max(min, Number(el.value) + delta))))
  return true
}

/** What "A" does on the focused element. Text fields return 'text' so the on-screen keyboard can open. */
export function activate(): 'text' | 'done' | 'none' {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return 'none'
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(el.type))) {
    return 'text'
  }
  if (el instanceof HTMLSelectElement) {
    // Native dropdowns can't be driven by a controller: cycle through the options instead.
    const next = (el.selectedIndex + 1) % el.options.length
    setNativeValue(el, el.options[next].value)
    return 'done'
  }
  el.click()
  return 'done'
}

/** Opens the right-click menu for the focused element (e.g. a game card). */
export function openContextMenu(): void {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 120), button: 2 }))
}

/** Presses Escape (closes the open menu or dialog). Returns true if one was open. */
export function closeLayer(): boolean {
  if (activeScope() === document) return false
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return true
}

/** The scroll container that holds the focused element (or the page's main one). */
export function scrollTarget(): HTMLElement | null {
  let el: HTMLElement | null = document.activeElement as HTMLElement | null
  while (el && el !== document.body) {
    const style = getComputedStyle(el)
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) return el
    el = el.parentElement
  }
  return [...document.querySelectorAll<HTMLElement>('main .overflow-y-auto')].find((e) => e.scrollHeight > e.clientHeight + 4) ?? null
}

/** Starts the game for the focused card, or the game page's Play button. */
export function playFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  const quick = el?.closest('[role="button"]')?.querySelector<HTMLElement>('[data-gamepad-play]')
  const target = quick ?? document.querySelector<HTMLElement>('main [data-gamepad-play-main]:not([disabled])')
  if (!target) return false
  target.click()
  return true
}
