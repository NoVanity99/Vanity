import { useEffect, useSyncExternalStore } from 'react'
import type { AccountStanding, AccountState } from '@shared/types'
import type { IncomingCall } from '@shared/voiceProtocol'

/**
 * The quick check-in with the Vanity server, every few seconds while you're signed in. It is how
 * things show up without restarting Vanity: coins you were given or bought, a call ringing for
 * you, a username changed on another device, a badge, a ban or a time-out.
 */
export interface Pulse {
  /** Your own account id. */
  myId: string | null
  coins: number | null
  calls: IncomingCall[]
}

const PULSE_MS = 5000
let current: Pulse = { myId: null, coins: null, calls: [] }
const listeners = new Set<() => void>()
/** Rings declined (or answered) here: not shown again while the server still lists them. Calling again is a new ring. */
const dismissed = new Set<string>()

function set(next: Pulse): void {
  const same = next.myId === current.myId && next.coins === current.coins && next.calls.length === current.calls.length && next.calls.every((c, i) => ringKey(c) === ringKey(current.calls[i]) && c.from.id === current.calls[i].from.id)
  if (same) return
  current = next
  listeners.forEach((l) => l())
}

type Answer = { id?: string; username: string | null; verified: boolean; admin: boolean; standing: AccountStanding; coins: number; calls: IncomingCall[] }

const ringKey = (c: IncomingCall): string => `${c.roomId}:${c.at ?? 0}`

let account: AccountState | null = null
let checking = false
export async function checkPulse(): Promise<void> {
  if (checking || !account?.signedIn) return
  checking = true
  try {
    const r = await window.vanity.account.request<Answer>('GET', '/pulse').catch(() => null)
    if (!r || r.error !== undefined) return
    const p = r.data
    set({ myId: p.id ?? current.myId, coins: p.coins, calls: (p.calls ?? []).filter((c) => !dismissed.has(ringKey(c))) })
    // Something about the account itself changed: have the app ask who it is now.
    const a = account
    if (a && (p.username !== a.username || p.verified !== a.verified || p.admin !== a.admin || p.standing.banned !== a.standing.banned || p.standing.timeoutUntil !== a.standing.timeoutUntil)) void window.vanity.account.refresh().catch(() => {})
  } finally {
    checking = false
  }
}

/** Shows a new balance at once (after buying something), ahead of the next check-in. */
export function setCoins(coins: number): void {
  set({ ...current, coins })
}

/** Stops showing a call here (it was answered or declined). */
export function dismissCall(call: IncomingCall): void {
  const key = ringKey(call)
  dismissed.add(key)
  set({ ...current, calls: current.calls.filter((c) => ringKey(c) !== key) })
  setTimeout(() => dismissed.delete(key), 60_000)
}

/** Mounted once, at the top of the app. */
export function usePulseRefresh(state: AccountState | null): void {
  account = state
  const on = !!state?.signedIn && !!state.username
  useEffect(() => {
    if (!on) {
      set({ myId: null, coins: null, calls: [] })
      return
    }
    void checkPulse()
    const timer = setInterval(() => void checkPulse(), PULSE_MS)
    const onFocus = (): void => void checkPulse()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [on])
}

export function usePulse(): Pulse {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

/** Your own account id (null until the first check-in). */
export const useMyId = (): string | undefined => usePulse().myId ?? undefined
