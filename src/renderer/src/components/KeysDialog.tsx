import { useEffect, useState } from 'react'
import { useToast } from '@/state/toasts'
import { Button, Dialog } from './Dialog'

const inputClass =
  'h-10 w-full rounded-lg border border-border bg-surface-2 px-3 font-mono text-sm outline-none transition placeholder:font-sans placeholder:text-muted focus:border-accent'

/**
 * Asks for the Twitch (IGDB) credentials, and optionally a SteamGridDB key, and
 * saves them in Vanity's encrypted settings. An alternative to .env.local.
 */
export function KeysDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }): React.JSX.Element {
  const toast = useToast()
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [sgdb, setSgdb] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.vanity.settings.get().then((s) => {
      setClientId(s.igdbClientId)
      setSecret(s.igdbClientSecret)
      setSgdb(s.steamGridDbApiKey)
    })
  }, [])

  const clean = (v: string): string => v.trim().replace(/^["']|["']$/g, '')
  const valid = clean(clientId) !== '' && clean(secret) !== ''

  async function save(): Promise<void> {
    if (!valid) return
    setSaving(true)
    try {
      await window.vanity.settings.update({ igdbClientId: clean(clientId), igdbClientSecret: clean(secret), steamGridDbApiKey: clean(sgdb) })
      toast('Keys saved')
      onSaved?.()
      onClose()
    } catch (err) {
      toast(`Could not save the keys: ${err instanceof Error ? err.message : err}`, 'error')
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Enter API keys"
      description="Saved encrypted on this PC. Used for Trending, game details and artwork."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Twitch client ID</span>
          <input autoFocus className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Twitch client secret</span>
          <input type="password" className={inputClass} value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <p className="text-xs text-muted">
          From your app at{' '}
          <a className="text-accent hover:underline" href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
            dev.twitch.tv/console/apps
          </a>{' '}
          (Manage → Client ID, and New Secret).
        </p>
        <label className="block border-t border-border pt-4">
          <span className="mb-1.5 block text-sm font-medium">
            SteamGridDB API key <span className="font-normal text-muted">(optional, for artwork)</span>
          </span>
          <input type="password" className={inputClass} value={sgdb} onChange={(e) => setSgdb(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
