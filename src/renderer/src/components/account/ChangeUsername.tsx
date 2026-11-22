import { useState } from 'react'
import { AtSign, Check, Clock } from 'lucide-react'
import type { AccountState } from '@shared/types'
import { FreeNote, useAvailability } from '@/components/auth/AuthForm'
import { Button, Dialog } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { useToast } from '@/state/toasts'

/**
 * Account → Change username. The new name shows for everyone, everywhere (friends lists, chats,
 * old messages, comments, calls), because Vanity knows accounts by a permanent id and only looks
 * the name up when showing it. Once every 30 days.
 */
export function ChangeUsername({ account, onClose }: { account: AccountState; onClose: () => void }): React.JSX.Element {
  const toast = useToast()
  const [username, setUsername] = useState(account.username ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const typed = username.trim()
  const sameName = typed.toLowerCase() === (account.username ?? '').toLowerCase()
  const free = useAvailability(sameName ? '' : typed, '', true)
  const waitUntil = account.usernameChangeAt
  // Only the capitals of your own name can be changed while waiting.
  const blocked = !!waitUntil && !sameName
  const valid = /^[A-Za-z0-9_]{3,20}$/.test(typed)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await window.vanity.account.setUsername(typed).catch(() => null)
    setBusy(false)
    if (!res || res.error !== undefined) return setError(res?.error ?? "Couldn't change it. Check your connection and try again.")
    toast(`You're now ${res.data.username}`)
    onClose()
  }

  return (
    <Dialog
      title="Change username"
      description="Your friends, chats, old messages and comments all show the new name straight away. You can change it once every 30 days."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !valid || typed === account.username || blocked || free.username === false} onClick={() => void save()} data-save-username>
            <Check className="size-4" /> {busy ? 'Saving…' : 'Change username'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && valid && typed !== account.username && !blocked && free.username !== false) void save()
        }}
        data-change-username
      >
        {waitUntil && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200" data-username-wait>
            <Clock className="size-4 shrink-0" /> You changed your username recently. You can change it again on {new Date(waitUntil).toLocaleDateString(undefined, { dateStyle: 'long' })}.
          </p>
        )}
        <div className="relative">
          <AtSign className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className={cn('h-11 w-full rounded-xl border border-border bg-surface-2 pl-10 pr-4 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15', free.username === false && 'border-accent')} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="New username" aria-label="New username" autoFocus spellCheck={false} maxLength={20} data-new-username />
        </div>
        <FreeNote free={free.username} what="username" />
        <p className="text-xs text-muted">3–20 letters, numbers or underscores. Your old name becomes free for someone else to take.</p>
        {error && (
          <p role="alert" className="animate-pop-in rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
