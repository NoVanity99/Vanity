import { useEffect, useState } from 'react'

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
