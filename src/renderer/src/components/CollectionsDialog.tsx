import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { createCollection, useCollections } from '@/state/collections'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'
import { Button, Dialog } from './Dialog'

/** Tick the collections a game belongs in, or make a new one for it. */
export function CollectionsDialog({ game, onClose }: { game: Game; onClose: () => void }): React.JSX.Element {
  const collections = useCollections()
  const { games, replaceGame } = useLibrary()
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Follow changes made while the dialog is open.
  const live = games.find((g) => g.id === game.id) ?? game

  const toggle = async (collectionId: number, member: boolean): Promise<void> => {
    const res = await window.vanity.collections.setMember(collectionId, live.id, member)
    if (res.error !== undefined) toast(res.error, 'error')
    else if (res.data) replaceGame(res.data)
  }

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const c = await createCollection(name)
      await toggle(c.id, true)
      setName('')
      toast(`Added ${live.name} to ${c.name}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Collections" description={`Choose where ${live.name} goes.`} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-1 p-4">
        {collections.length === 0 && <p className="px-2 py-3 text-sm text-muted">No collections yet. Make your first one below.</p>}
        {collections.map((c) => {
          const member = live.collections.includes(c.id)
          return (
            <button
              key={c.id}
              role="checkbox"
              aria-checked={member}
              onClick={() => void toggle(c.id, !member)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
            >
              <span className={cn('flex size-5 items-center justify-center rounded-md border transition', member ? 'border-accent bg-accent text-white' : 'border-white/20')}>
                {member && <Check className="size-3.5" />}
              </span>
              <span className="flex-1">{c.name}</span>
              <span className="text-xs tabular-nums text-muted">{games.filter((g) => g.collections.includes(c.id)).length}</span>
            </button>
          )
        })}
        <form onSubmit={create} className="flex gap-2 border-t border-border px-1 pt-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="New collection, e.g. Co-op nights"
            className="h-10 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none transition placeholder:text-muted hover:border-white/20 focus:border-accent"
          />
          <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
            <Plus className="size-4" /> Create
          </Button>
        </form>
      </div>
    </Dialog>
  )
}

/** Asks for a collection name (new or renamed). */
export function NameDialog({ title, initial = '', confirm, onSubmit, onClose }: { title: string; initial?: string; confirm: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    try {
      await onSubmit(name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!name.trim()}>
            {confirm}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="p-6">
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          maxLength={60}
          placeholder="Collection name"
          className="h-11 w-full rounded-lg border border-border bg-surface-2 px-3 outline-none transition placeholder:text-muted hover:border-white/20 focus:border-accent"
        />
        {error && <p className="mt-2 text-sm text-accent">{error}</p>}
      </form>
    </Dialog>
  )
}
