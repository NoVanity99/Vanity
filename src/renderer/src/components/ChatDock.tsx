import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gamepad2, Minus, Settings2, UserRound, Users, X } from 'lucide-react'
import type { Friend } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { FriendChat } from '@/components/FriendChat'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { useAccount } from '@/state/account'
import { closeChat, groupChatId, isGroupChat, minimizeChat, refreshChatFriends, setChatOwner, useOpenChats, type OpenChat } from '@/state/chats'
import { useGroups } from '@/state/groups'
import { GroupChat } from '@/components/chat/GroupChat'
import { CallButton } from '@/components/voice/CallLayer'
import { useMyId } from '@/state/pulse'
import { GroupSettingsDialog } from '@/components/chat/GroupDialogs'
import type { GroupChat as Group } from '@shared/groups'
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
  const groups = useGroups()
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
  const groupById = new Map((groups ?? []).map((g) => [groupChatId(g.id), g]))
  // Friends you're no longer friends with, and groups you left, lose their pop-up.
  const shown = chats.filter((c) => (isGroupChat(c.friend.id) ? !groups || groupById.has(c.friend.id) : !friends || live.has(c.friend.id)))
  if (shown.length === 0) return null
  // On a phone there is room for one open chat: the newest; the others show as bars.
  const newestOpen = [...shown].reverse().find((c) => !c.minimized)?.friend.id

  return (
    <div ref={dock} data-chat-dock className="pointer-events-none fixed bottom-0 right-4 z-[45] flex flex-row-reverse items-end gap-3 max-md:inset-x-2 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:flex-col max-md:items-stretch max-md:gap-1.5">
      {[...shown].reverse().map((c) => (
        isGroupChat(c.friend.id) ? (
          groupById.get(c.friend.id) ? <GroupPopup key={c.friend.id} chat={c} group={groupById.get(c.friend.id)!} phoneHidden={!c.minimized && c.friend.id !== newestOpen} /> : null
        ) : (
          <ChatPopup key={c.friend.id} chat={c} friend={live.get(c.friend.id)} phoneHidden={!c.minimized && c.friend.id !== newestOpen} />
        )
      ))}
    </div>
  )
}

function ChatPopup({ chat, friend, phoneHidden }: { chat: OpenChat; friend: Friend | undefined; phoneHidden: boolean }): React.JSX.Element {
  const myId = useMyId()
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
              <CallButton friendId={f.id} myId={myId} className={iconButton} />
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

/** A group chat's pop-up: the group's name and people, settings, minimize and close. */
function GroupPopup({ chat, group, phoneHidden }: { chat: OpenChat; group: Group; phoneHidden: boolean }): React.JSX.Element {
  const [settings, setSettings] = useState(false)
  const id = chat.friend.id
  const iconButton = 'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-text'
  const who = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="flex -space-x-2">
        {group.members.slice(0, 3).map((m) => (
          <Avatar key={m.id} name={m.username} src={m.avatar} size="sm" className="ring-2 ring-surface" />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{group.name}</span>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <Users className="size-3" /> {group.members.length} people
        </span>
      </span>
    </span>
  )
  if (chat.minimized) {
    return (
      <div data-chat-popup="minimized" className="pointer-events-auto relative w-60 overflow-clip rounded-t-xl border border-b-0 border-white/15 bg-surface shadow-2xl shadow-black/60 max-md:w-full max-md:rounded-xl max-md:border-b">
        <div className="relative flex items-center gap-1 py-1.5 pl-2.5 pr-1.5">
          <button onClick={() => minimizeChat(id, false)} className="flex min-w-0 flex-1 items-center text-left" title={`Open ${group.name}`} data-chat-restore>
            {who}
          </button>
          {group.unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold tabular-nums text-white" data-chat-unread>
              {group.unread > 99 ? '99+' : group.unread}
            </span>
          )}
          <button onClick={() => closeChat(id)} aria-label={`Close ${group.name}`} title="Close (the chat is kept)" className={iconButton} data-chat-close>
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
      <GroupChat
        group={group}
        className="h-full"
        header={
          <div className="relative flex shrink-0 items-center gap-1 border-b border-border bg-gradient-to-r from-accent/20 to-transparent py-2 pl-3 pr-1.5">
            <button onClick={() => minimizeChat(id)} className="flex min-w-0 flex-1 items-center text-left" title="Minimize">
              {who}
            </button>
            <CallButton groupId={group.id} className={iconButton} />
            <button onClick={() => setSettings(true)} aria-label="Group settings" title="People, name, leave" className={iconButton} data-group-settings>
              <Settings2 className="size-4" />
            </button>
            <button onClick={() => minimizeChat(id)} aria-label="Minimize" title="Minimize" className={iconButton} data-chat-minimize>
              <Minus className="size-4" />
            </button>
            <button onClick={() => closeChat(id)} aria-label="Close" title="Close (the chat is kept)" className={iconButton} data-chat-close>
              <X className="size-4" />
            </button>
          </div>
        }
      />
      {settings && <GroupSettingsDialog group={group} onClose={() => setSettings(false)} />}
    </div>
  )
}
