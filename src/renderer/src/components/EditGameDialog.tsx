import { useState } from 'react'
import { Wand2 } from 'lucide-react'
import type { Game, GamePatch } from '@shared/types'
import { useLibrary } from '@/state/library'
import { Button, Dialog } from './Dialog'
import { MatchDialog } from './MatchDialog'

const inputClass =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-accent'

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** Edit a game's name, details and program. Edited details are kept when metadata is refreshed. */
export function EditGameDialog({ game, onClose }: { game: Game; onClose: () => void }): React.JSX.Element {
  const { updateGame, pickExecutable, games } = useLibrary()
  // Read the live game so a new exe or match shows up straight away.
  const current = games.find((g) => g.id === game.id) ?? game
  const usesLauncher = game.source === 'steam' || game.source === 'epic'
  const [name, setName] = useState(game.name)
  const [description, setDescription] = useState(game.description ?? '')
  const [developer, setDeveloper] = useState(game.developer ?? '')
  const [releaseDate, setReleaseDate] = useState(game.releaseDate ?? '')
  const [genres, setGenres] = useState(game.genres.join(', '))
  const [matching, setMatching] = useState(false)
  const valid = name.trim().length > 0

  async function save(): Promise<void> {
    if (!valid) return
    const patch: GamePatch = {}
    if (name.trim() !== game.name) patch.name = name.trim()
    if (description.trim() !== (game.description ?? '')) patch.description = description
    if (developer.trim() !== (game.developer ?? '')) patch.developer = developer
    if (releaseDate.trim() !== (game.releaseDate ?? '')) patch.releaseDate = releaseDate
    const genreList = genres.split(',').map((g) => g.trim()).filter(Boolean)
    if (genreList.join('|') !== game.genres.join('|')) patch.genres = genreList
    if (Object.keys(patch).length) await updateGame(game.id, patch)
    onClose()
  }

  if (matching) return <MatchDialog game={current} onClose={onClose} />

  return (
    <Dialog
      title="Edit game"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button className="mr-auto" onClick={() => setMatching(true)}>
            <Wand2 className="size-4" /> Fix match…
          </Button>
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
        className="space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Name" htmlFor="game-name" hint="A name you set here is kept when the library is rescanned.">
          <input id="game-name" autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Description" htmlFor="game-description">
          <textarea
            id="game-description"
            rows={5}
            className={`${inputClass} resize-y leading-relaxed`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Developer" htmlFor="game-developer">
            <input id="game-developer" className={inputClass} value={developer} onChange={(e) => setDeveloper(e.target.value)} />
          </Field>
          <Field label="Release date" htmlFor="game-release">
            <input
              id="game-release"
              type="date"
              className={`${inputClass} [color-scheme:dark]`}
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Genres" htmlFor="game-genres" hint="Separate with commas. Edited details aren't overwritten when metadata refreshes.">
          <input id="game-genres" className={inputClass} value={genres} onChange={(e) => setGenres(e.target.value)} />
        </Field>

        {!usesLauncher && (
          <Field label="Program" htmlFor="game-exe" hint="The .exe that Play starts. Your choice is kept when the library is rescanned.">
            <div className="flex items-center gap-3">
              <p id="game-exe" className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted" title={current.executablePath ?? ''}>
                {current.executablePath ?? 'Not set'}
              </p>
              <Button type="button" onClick={() => pickExecutable(game.id)}>
                Browse…
              </Button>
            </div>
          </Field>
        )}
      </form>
    </Dialog>
  )
}
