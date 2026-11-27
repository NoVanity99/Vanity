import { useEffect, useState } from 'react'

/** True in the Mac app. */
export function isMac(): boolean {
  return window.vanity.os === 'darwin'
}

/** How a shortcut's modifier key is written: ⌘ on a Mac, Ctrl elsewhere. `keys` is the rest, e.g. "K". */
export function shortcut(keys: string): string {
  return isMac() ? `⌘${keys.replace(/^Enter$/, '↩')}` : `Ctrl+${keys}`
}

/** What the computer's own notifications are called here. */
export function systemName(): string {
  return isAndroid() ? 'phone' : isMac() ? 'Mac' : 'Windows'
}

/** True in the Android app (false in the Windows desktop app). */
export function isAndroid(): boolean {
  return window.vanity.platform === 'android'
}

/** How the per-game menu is opened: "Right-click" with a mouse, "Touch and hold" on a phone. */
export function menuGesture(): string {
  return isAndroid() ? 'Touch and hold' : 'Right-click'
}

const PHONE = '(max-width: 767px)'

/** True on phone-sized screens (the layout switches to a bottom bar and single columns). */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const on = (): void => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
