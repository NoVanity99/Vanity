import { describe, expect, it } from 'vitest'
import type { Friend } from '@shared/types'
import { systemNotification } from '../notifications'

const ann = { id: 'a1', username: 'ann', status: { state: 'playing', gameName: 'Hades', since: null, lastSeen: null } } as unknown as Friend

describe('Windows / Android notifications', () => {
  it('say who, what and open the right place', () => {
    expect(systemNotification({ kind: 'online', friend: ann, action: 'is online', detail: null, to: '' })).toEqual({ title: 'ann is online', body: 'ann is online', action: 'friend:a1' })
    expect(systemNotification({ kind: 'playing', friend: ann, action: 'started playing Hades', detail: null, to: '' })).toEqual({ title: 'ann is playing', body: 'Hades', action: 'friend:a1' })
    expect(systemNotification({ kind: 'message', friend: ann, action: 'sent you a message', detail: 'gg!', to: '' })).toEqual({ title: 'ann', body: 'gg!', action: 'chat:a1' })
    expect(systemNotification({ kind: 'message', friend: ann, action: 'wrote in Squad', detail: 'raid?', to: '', group: { id: 'g1', name: 'Squad' } })).toEqual({ title: 'ann in Squad', body: 'raid?', action: 'group:g1' })
  })
})
