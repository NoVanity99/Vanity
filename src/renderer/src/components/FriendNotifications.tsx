import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gamepad2, MessageCircle, Wifi, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { openChat } from '@/state/chats'
import { onFriendNote, type FriendNote } from '@/state/friends'
import { useInterface } from '@/state/settings'

const SHOWN_MS = 7000
const KINDS = {
  online: { icon: Wifi, tone: 'text-emerald-400', label: 'Online' },
  playing: { icon: Gamepad2, tone: 'text-accent', label: 'Now playing' },
  message: { icon: MessageCircle, tone: 'text-sky-400', label: 'New message' }
} as const

/**
 * Cards in the top-right corner when a friend comes online, starts a game or writes to you:
 * their banner behind, their picture and name, and what happened. Click one to go to their
 * profile (or the chat). While Vanity isn't in front, a Windows notification is shown too.
 * Each kind can be turned off in Settings → Customize.
 */
export function FriendNotifications(): React.JSX.Element | null {
  const navigate = useNavigate()
  const ui = useInterface()
  const [notes, setNotes] = useState<(FriendNote & { leaving?: boolean })[]>([])

  useEffect(() => {
    const wanted = { online: ui.notifyFriendOnline, playing: ui.notifyFriendPlaying, message: ui.notifyFriendMessage }
    return onFriendNote((note) => {
      if (!wanted[note.kind]) return
      // At most four at once: the oldest makes room.
      setNotes((list) => [...list.slice(-3), note])
      setTimeout(() => setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, leaving: true } : n))), SHOWN_MS - 250)
      setTimeout(() => setNotes((list) => list.filter((n) => n.id !== note.id)), SHOWN_MS)
      if (!document.hasFocus()) void window.vanity.notify(`${note.friend.username} ${note.action}`, note.detail ?? 'Vanity').catch(() => {})
    })
  }, [ui.notifyFriendOnline, ui.notifyFriendPlaying, ui.notifyFriendMessage])

  if (notes.length === 0) return null
  const close = (id: number): void => setNotes((list) => list.filter((n) => n.id !== id))

  return (
    <div className="pointer-events-none fixed right-4 top-12 z-[55] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 max-md:left-4 max-md:right-4 max-md:top-[calc(3rem+env(safe-area-inset-top))] max-md:w-auto" aria-live="polite">
      {notes.map((note) => {
        const kind = KINDS[note.kind]
        const Icon = kind.icon
        return (
          <div
            key={note.id}
            role="status"
            data-friend-note={note.kind}
            className={cn(
              'pointer-events-auto relative overflow-clip rounded-2xl border border-white/15 bg-surface shadow-2xl shadow-black/60',
              note.leaving ? 'animate-[toast-out_240ms_ease-in_forwards]' : 'animate-[note-in_320ms_cubic-bezier(0.2,0.8,0.2,1)]'
            )}
          >
            <span aria-hidden className="profile-banner" data-banner={note.friend.style?.banner ?? 'default'} />
            <button
              onClick={() => {
                close(note.id)
                // A message opens its chat pop-up; anything else, the friend's page.
                if (note.kind === 'message') openChat(note.friend)
                else navigate(note.to)
              }}
              className="relative flex w-full items-center gap-3 p-3.5 pr-10 text-left"
              title={note.kind === 'message' ? 'Open the chat' : `Open ${note.friend.username}'s profile`}
            >
              <Avatar name={note.friend.username} src={note.friend.avatar} frame={note.friend.style?.frame} status={note.friend.status.state} />
              <span className="min-w-0 flex-1">
                <span className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest', kind.tone)}>
                  <Icon className="size-3" /> {kind.label}
                </span>
                <span className="block truncate text-sm">
                  <UserName name={note.friend.username} style={note.friend.style} verified={note.friend.verified} admin={note.friend.admin} className="font-bold" />{' '}
                </span>
                <span className="block truncate text-xs text-text/80">{note.detail ?? note.action}</span>
              </span>
            </button>
            <button onClick={() => close(note.id)} aria-label="Dismiss" className="absolute right-2 top-2 rounded-full p-1 text-muted transition hover:bg-white/10 hover:text-text">
              <X className="size-3.5" />
            </button>
            {/* A thin line that runs out as the card's time does. */}
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent/70" style={{ animation: `note-timer ${SHOWN_MS}ms linear forwards` }} />
          </div>
        )
      })}
    </div>
  )
}
