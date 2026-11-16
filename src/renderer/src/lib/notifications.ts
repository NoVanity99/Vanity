import type { FriendNote } from '@/state/friends'

/** What the Windows / Android notification says, and what clicking it opens. */
export function systemNotification(note: Omit<FriendNote, 'id'>): { title: string; body: string; action: string } {
  const name = note.friend.username
  if (note.group) return { title: `${name} in ${note.group.name}`, body: note.detail ?? 'New message', action: `group:${note.group.id}` }
  if (note.kind === 'message') return { title: name, body: note.detail ?? 'Sent you a message', action: `chat:${note.friend.id}` }
  if (note.kind === 'playing') return { title: `${name} is playing`, body: note.friend.status.gameName ?? note.action, action: `friend:${note.friend.id}` }
  if (note.kind === 'voice') return { title: `${name} is in voice`, body: `${name} ${note.action}. Join them on the Voice page.`, action: 'voice' }
  return { title: `${name} is online`, body: `${name} ${note.action}`, action: `friend:${note.friend.id}` }
}
