import { useEffect, useState } from 'react'
import type { AccountState } from '@shared/types'

/** The Vanity account state, kept current across the app. */
export function useAccount(): AccountState | null {
  const [state, setState] = useState<AccountState | null>(null)
  useEffect(() => {
    window.vanity.account.state().then(setState, () => {})
    return window.vanity.account.onChange(setState)
  }, [])
  return state
}
