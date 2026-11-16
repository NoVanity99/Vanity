import { useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gamepad2, Minus, UserRound, X } from 'lucide-react'
import type { Friend } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { FriendChat } from '@/components/FriendChat'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { useAccount } from '@/state/account'
import { closeChat, minimizeChat, refreshChatFriends, setChatOwner, useOpenChats, type OpenChat } from '@/state/chats'
import { useFriends } from '@/state/friends'
import { statusLine } from '@/pages/FriendsPage'

/**
 * Chat pop-ups along the bottom-right of the window, like a messenger: they stay open while you
 * move around Vanity, and come back after a restart. Minimize folds one into a small bar (with
 * its unread count); close removes the pop-up, never the conversation.
 */
export function ChatDock(): React.JSX.Element | null {
  const account = useAccount()
  const chats = useOpenChats()
  const friends = useFriends()
  const dock = useRef<HTMLDivElement>(null)
  const username = account?.signedIn ? account.username : null

  useEffect(() => setChatOwner(username), [username])
  useEffect(() => {
    if (friends) refreshChatFriends(friends.friends)
  }, [friends])

  // Toasts sit above the dock instead of under it.
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = dock.current
    if (!el) {
      root.style.removeProperty('--chat-dock-h')
      return
    }
    const update = (): void => root.style.setProperty('--chat-dock-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--chat-dock-h')
    }
  }, [chats.length, username])

  if (!username || chats.length === 0) return null
  const live = new Map((friends?.friends ?? []).map((f) => [f.id, f]))
  // Friends you're no longer friends with lose their pop-up (their chat can't be opened any more).
  const shown = friends ? chats.filter((c) => live.has(c.friend.id)) : chats
  if (shown.length === 0) return null
  // On a phone there is room for one open chat: the newest; the others show as bars.
  const newestOpen = [...shown].reverse().find((c) => !c.minimized)?.friend.id

  return (
    <div ref={dock} data-chat-dock className="pointer-events-none fixed bottom-0 right-4 z-[45] flex flex-row-reverse items-end gap-3 max-md:inset-x-2 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:flex-col max-md:items-stretch max-md:gap-1.5">
      {[...shown].reverse().map((c) => (
        <ChatPopup key={c.friend.id} chat={c} friend={live.get(c.friend.id)} phoneHidden={!c.minimized && c.friend.id !== newestOpen} />
      ))}
    </div>
  )
}

function ChatPopup({ chat, friend, phoneHidden }: { chat: OpenChat; friend: Friend | undefined; phoneHidden: boolean }): React.JSX.Element {
  const navigate = useNavigate()
  const f = { ...chat.friend, ...(friend ?? {}) }
  const unread = friend?.unread ?? 0
  const playing = friend?.status.state === 'playing'
  const who = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <Avatar name={f.username} src={f.avatar} frame={f.style?.frame} aura={f.style?.aura} size="sm" status={friend?.status.state} />
      <span className="min-w-0 flex-1">
        <UserName name={f.username} style={f.style} verified={f.verified} admin={f.admin} className="flex text-sm font-semibold" />
        {friend && (
          <span className={cn('flex items-center gap-1 truncate text-[11px]', playing ? 'text-accent' : friend.status.state === 'online' ? 'text-emerald-400' : 'text-muted')}>
            {playing && <Gamepad2 className="size-3 shrink-0" />}
            <span className="truncate">{statusLine(friend)}</span>
          </span>
        )}
      </span>
    </span>
  )
  const iconButton = 'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-text'

  if (chat.minimized) {
    return (
      <div data-chat-popup="minimized" className="pointer-events-auto relative w-60 overflow-clip rounded-t-xl border border-b-0 border-white/15 bg-surface shadow-2xl shadow-black/60 max-md:w-full max-md:rounded-xl max-md:border-b">
        <span aria-hidden className="profile-banner opacity-70" data-banner={f.style?.banner ?? 'default'} data-fx={f.style?.effect ?? 'none'} />
        <div className="relative flex items-center gap-1 py-1.5 pl-2.5 pr-1.5">
          <button onClick={() => minimizeChat(f.id, false)} className="flex min-w-0 flex-1 items-center text-left" title={`Open the chat with ${f.username}`} data-chat-restore>
            {who}
          </button>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold tabular-nums text-white" data-chat-unread>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          <button onClick={() => closeChat(f.id)} aria-label={`Close the chat with ${f.username}`} title="Close (the chat is kept)" className={iconButton} data-chat-close>
            <X className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-chat-popup="open"
      className={cn(
        'pointer-events-auto flex h-[460px] max-h-[calc(100vh-5rem)] w-[340px] animate-[note-in_220ms_cubic-bezier(0.2,0.8,0.2,1)] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-white/15 shadow-2xl shadow-black/70',
        'max-md:h-[min(70vh,520px)] max-md:w-full max-md:rounded-2xl max-md:border-b',
        phoneHidden && 'max-md:hidden'
      )}
    >
      <FriendChat
        friend={f}
        autoFocus
        className="h-full rounded-none border-0"
        header={
          <div className="relative shrink-0 overflow-clip border-b border-border">
            <span aria-hidden className="profile-banner" data-banner={f.style?.banner ?? 'default'} data-fx={f.style?.effect ?? 'none'} />
            <div className="relative flex items-center gap-1 py-2 pl-3 pr-1.5">
              <button onClick={() => minimizeChat(f.id)} className="flex min-w-0 flex-1 items-center text-left" title="Minimize">
                {who}
              </button>
              <button onClick={() => navigate(`/friends/${f.id}`)} aria-label={`Open ${f.username}'s profile`} title="Open their profile" className={iconButton}>
                <UserRound className="size-4" />
              </button>
              <button onClick={() => minimizeChat(f.id)} aria-label="Minimize" title="Minimize" className={iconButton} data-chat-minimize>
                <Minus className="size-4" />
              </button>
              <button onClick={() => closeChat(f.id)} aria-label="Close" title="Close (the chat is kept)" className={iconButton} data-chat-close>
                <X className="size-4" />
              </button>
            </div>
          </div>
        }
      />
    </div>
  )
}
