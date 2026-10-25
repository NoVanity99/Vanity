import { useCallback, useState } from 'react'
import { EyeOff, Eye, FolderOpen, Image, Layers, Pencil, Play, RefreshCw, Star, StarOff, Trash2 } from 'lucide-react'
import type { Game } from '@shared/types'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'
import { ArtworkDialog } from './ArtworkDialog'
import { CollectionsDialog } from './CollectionsDialog'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { EditGameDialog } from './EditGameDialog'

/**
 * The per-game actions menu, shared by the grid and the detail page.
 * Returns an opener for onContextMenu/onClick and the element to render.
 */
export function useGameMenu(): {
  openMenu: (e: React.MouseEvent, game: Game) => void
  menu: React.JSX.Element | null
} {
  const { updateGame, removeGame, openFolder, launch, sessions, replaceGame } = useLibrary()
  const toast = useToast()
  const [state, setState] = useState<{ x: number; y: number; game: Game } | null>(null)
  const [editing, setEditing] = useState<Game | null>(null)
  const [artwork, setArtwork] = useState<Game | null>(null)
  const [collecting, setCollecting] = useState<Game | null>(null)

  const refreshMetadata = useCallback(
    async (g: Game) => {
      toast(`Refreshing ${g.name}…`)
      const res = await window.vanity.metadata.refresh(g.id)
      if (res.error !== undefined) toast(res.error, 'error')
      else if (res.data) {
        replaceGame(res.data)
        if (res.data.metadata.status === 'matched') toast(`Updated ${res.data.name}`)
        else if (res.data.metadata.error) toast(res.data.metadata.error, 'error')
      }
    },
    [replaceGame, toast]
  )

  const openMenu = useCallback((e: React.MouseEvent, game: Game) => {
    e.preventDefault()
    e.stopPropagation()
    setState({ x: e.clientX, y: e.clientY, game })
  }, [])

  const close = useCallback(() => setState(null), [])

  let menu: React.JSX.Element | null = null
  if (state) {
    const g = state.game
    const items: MenuItem[] = [
      sessions[g.id]
        ? { label: sessions[g.id] === 'running' ? 'Playing' : 'Launching…', icon: Play, onSelect: () => {}, disabled: true }
        : { label: 'Play', icon: Play, onSelect: () => launch(g.id) },
      {
        label: g.favorite ? 'Remove from favorites' : 'Add to favorites',
        icon: g.favorite ? StarOff : Star,
        onSelect: () => updateGame(g.id, { favorite: !g.favorite })
      },
      { label: g.collections.length ? `Collections (${g.collections.length})…` : 'Add to collection…', icon: Layers, onSelect: () => setCollecting(g) },
      { label: 'Edit metadata', icon: Pencil, onSelect: () => setEditing(g) },
      { label: 'Change artwork', icon: Image, onSelect: () => setArtwork(g) },
      { label: 'Refresh metadata', icon: RefreshCw, onSelect: () => refreshMetadata(g) },
      {
        label: g.hidden ? 'Unhide' : 'Hide',
        icon: g.hidden ? Eye : EyeOff,
        onSelect: () => updateGame(g.id, { hidden: !g.hidden })
      },
      {
        label: 'Open folder',
        icon: FolderOpen,
        onSelect: () => openFolder(g.id),
        disabled: !g.installPath && !g.executablePath
      },
      { type: 'separator' },
      { label: 'Remove from library', icon: Trash2, onSelect: () => removeGame(g.id), danger: true }
    ]
    menu = <ContextMenu x={state.x} y={state.y} items={items} onClose={close} />
  }

  return {
    openMenu,
    menu: (
      <>
        {menu}
        {editing && <EditGameDialog game={editing} onClose={() => setEditing(null)} />}
        {artwork && <ArtworkDialog game={artwork} onClose={() => setArtwork(null)} />}
        {collecting && <CollectionsDialog game={collecting} onClose={() => setCollecting(null)} />}
      </>
    )
  }
}
