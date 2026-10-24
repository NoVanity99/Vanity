import { useState } from 'react'
import type { Game } from '@shared/types'
import { useLibrary } from '@/state/library'
import { Button, Dialog } from './Dialog'

/** Edit a game's details. Stage 5 adds metadata fields and re-matching. */
export function EditGameDialog({ game, onClose }: { game: Game; onClose: () => void }): React.JSX.Element {
  const { updateGame, pickExecutable, games } = useLibrary()
  // Read the live game so a newly picked exe shows up straight away.
  const current = games.find((g) => g.id === game.id) ?? game
  const usesLauncher = game.source === 'steam' || game.source === 'epic'
  const [name, setName] = useState(game.name)
  const valid = name.trim().length > 0

  async function save(): Promise<void> {
    if (!valid) return
    if (name.trim() !== game.name) await updateGame(game.id, { name: name.trim() })
    onClose()
  }

  return (
    <Dialog
      title="Edit game"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-2 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label className="block text-sm font-medium" htmlFor="game-name">
          Name
        </label>
        <input
          id="game-name"
          autoFocus
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 outline-none transition focus:border-accent"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-xs text-muted">A name you set here is kept when the library is rescanned.</p>
        {!usesLauncher && (
          <div className="pt-4">
            <p className="mb-1.5 text-sm font-medium">Program</p>
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted" title={current.executablePath ?? ''}>
                {current.executablePath ?? 'Not set'}
              </p>
              <Button type="button" onClick={() => pickExecutable(game.id)}>
                Browse…
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted">The .exe that Play starts. Your choice is kept when the library is rescanned.</p>
          </div>
        )}
      </form>
    </Dialog>
  )
}
