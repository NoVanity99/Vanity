import { describe, expect, it } from 'vitest'
import type { Friend, FriendsList } from '@shared/types'
import { DEFAULT_PROFILE_STYLE } from '@shared/profileStyle'
import { notesFor } from '../friends'

const friend = (id: string, state: Friend['status']['state'], game: string | null = null, last: { id: number; mine: boolean; text: string } | null = null): Friend => ({
  id,
  username: id,
  avatar: null,
  style: DEFAULT_PROFILE_STYLE,
  verified: false,
  admin: false,
  bio: '',
  unread: 0,
  lastMessage: last ? { ...last, at: 1 } : null,
  status: { state, gameName: game, since: game ? 1 : null, lastSeen: 1 },
  totalPlaytimeSeconds: 0,
  gamesPlayed: 0,
  topGame: null,
  level: 1,
  xp: 0
})
const list = (...friends: Friend[]): FriendsList => ({ friends, incoming: [], outgoing: [] })
const was = (...friends: Friend[]) => new Map(friends.map((f) => [f.id, { state: f.status.state, game: f.status.gameName, lastMessage: f.lastMessage?.id ?? 0 }]))
const said = (prev: ReturnType<typeof was>, now: FriendsList, watching: string | null = null): string[] => notesFor(prev, now, watching).map((n) => `${n.friend.id} ${n.action}${n.detail ? `: ${n.detail}` : ''}`)

describe('friend notifications', () => {
  it('says when a friend comes online', () => {
    expect(said(was(friend('max', 'offline')), list(friend('max', 'online')))).toEqual(['max is online'])
    expect(said(was(friend('max', 'online')), list(friend('max', 'online')))).toEqual([])
    expect(said(was(friend('max', 'online')), list(friend('max', 'offline')))).toEqual([])
  })

  it('says when a friend starts a game, with its name, once', () => {
    expect(said(was(friend('max', 'online')), list(friend('max', 'playing', 'Hades')))).toEqual(['max started playing Hades'])
    expect(said(was(friend('max', 'playing', 'Hades')), list(friend('max', 'playing', 'Hades')))).toEqual([])
    expect(said(was(friend('max', 'playing', 'Hades')), list(friend('max', 'playing', 'Portal 2')))).toEqual(['max started playing Portal 2'])
    // Coming online straight into a game is one notification, not two.
    expect(said(was(friend('max', 'offline')), list(friend('max', 'playing', 'Hades')))).toEqual(['max started playing Hades'])
  })

  it('says when a friend sends a message, but not for your own or one you are looking at', () => {
    const before = was(friend('max', 'online', null, { id: 4, mine: false, text: 'old' }))
    expect(said(before, list(friend('max', 'online', null, { id: 5, mine: false, text: 'hey!' })))).toEqual(['max sent you a message: hey!'])
    expect(said(before, list(friend('max', 'online', null, { id: 5, mine: true, text: 'my reply' })))).toEqual([])
    expect(said(before, list(friend('max', 'online', null, { id: 4, mine: false, text: 'old' })))).toEqual([])
    expect(said(before, list(friend('max', 'online', null, { id: 5, mine: false, text: 'hey!' })), 'max')).toEqual([])
    expect(said(was(friend('max', 'online')), list(friend('max', 'online', null, { id: 1, mine: false, text: 'first!' })))).toEqual(['max sent you a message: first!'])
  })

  it('stays quiet about someone who has only just become a friend', () => {
    expect(said(was(friend('max', 'online')), list(friend('max', 'online'), friend('new', 'playing', 'Hades', { id: 9, mine: false, text: 'hi' })))).toEqual([])
  })
})
