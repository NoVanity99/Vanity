import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { pickSurprise } from '../surprise'

const game = (id: number, over: Partial<Game> = {}): Game => ({ id, name: `G${id}`, hidden: false, missing: false, lastPlayedAt: null, ...over }) as Game

describe('pickSurprise', () => {
  it('never picks hidden or missing games', () => {
    const games = [game(1, { hidden: true }), game(2, { missing: true }), game(3)]
    for (let i = 0; i < 50; i++) expect(pickSurprise(games)?.id).toBe(3)
    expect(pickSurprise([game(1, { hidden: true })])).toBeNull()
  })

  it('favours games not played lately', () => {
    const now = Date.now()
    const games = [game(1, { lastPlayedAt: now - 1000 }), game(2)]
    const counts = { 1: 0, 2: 0 }
    for (let i = 0; i < 2000; i++) counts[pickSurprise(games, Math.random, now)!.id as 1 | 2]++
    expect(counts[2]).toBeGreaterThan(counts[1] * 2)
    expect(counts[1]).toBeGreaterThan(0)
  })
})
