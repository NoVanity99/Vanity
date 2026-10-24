import { describe, expect, it } from 'vitest'
import { GamepadInput, padKind, type Action, type PadSnapshot } from '../input'
import { pickNext, type Box } from '../spatial'

const box = (left: number, top: number, w = 100, h = 100): Box => ({ left, top, right: left + w, bottom: top + h })

describe('pickNext', () => {
  // A 3x2 grid of cards, 100px apart, plus a sidebar item on the left.
  const grid = [box(200, 0), box(320, 0), box(440, 0), box(200, 120), box(320, 120), box(440, 120), box(0, 130, 150, 30)]

  it('moves within rows and columns', () => {
    expect(pickNext(grid[0], grid, 'right')).toBe(1)
    expect(pickNext(grid[1], grid, 'down')).toBe(4)
    expect(pickNext(grid[4], grid, 'up')).toBe(1)
    expect(pickNext(grid[5], grid, 'left')).toBe(4)
  })

  it('returns -1 at an edge', () => {
    expect(pickNext(grid[2], grid, 'right')).toBe(-1)
    expect(pickNext(grid[0], grid, 'up')).toBe(-1)
  })

  it('crosses from the grid into the sidebar', () => {
    expect(pickNext(grid[3], grid, 'left')).toBe(6)
  })

  it('prefers aligned elements over closer diagonal ones', () => {
    const from = box(0, 0)
    const aligned = box(0, 400)
    const diagonal = box(150, 120)
    expect(pickNext(from, [diagonal, aligned], 'down')).toBe(1)
  })
})

function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): PadSnapshot {
  return { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)', buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })), axes }
}

describe('GamepadInput', () => {
  function setup() {
    const actions: Action[] = []
    const scrolls: number[] = []
    const input = new GamepadInput((a) => actions.push(a), (_x, y) => scrolls.push(y))
    return { input, actions, scrolls }
  }

  it('fires buttons once per press', () => {
    const { input, actions } = setup()
    input.update(pad([0]), 0)
    input.update(pad([0]), 16)
    input.update(pad([]), 32)
    input.update(pad([0]), 48)
    expect(actions).toEqual(['confirm', 'confirm'])
  })

  it('repeats held directions after a delay, from the D-pad or the stick', () => {
    const { input, actions } = setup()
    for (let t = 0; t <= 600; t += 16) input.update(pad([13]), t)
    expect(actions[0]).toBe('down')
    expect(actions.length).toBeGreaterThanOrEqual(2)
    expect(actions.length).toBeLessThan(6)
    const s = setup()
    s.input.update(pad([], [0.9, 0, 0, 0]), 0)
    expect(s.actions).toEqual(['right'])
  })

  it('maps the shoulder, trigger and menu buttons', () => {
    const { input, actions } = setup()
    for (const b of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      input.update(pad([b]), b * 1000)
      input.update(pad([]), b * 1000 + 16)
    }
    expect(actions).toEqual(['back', 'options', 'search', 'prevTab', 'nextTab', 'pageUp', 'pageDown', 'view', 'play'])
  })

  it('scrolls with the right stick outside the dead zone', () => {
    const { input, scrolls } = setup()
    input.update(pad([], [0, 0, 0, 0.1]), 0)
    input.update(pad([], [0, 0, 0, -0.8]), 16)
    expect(scrolls).toEqual([-0.8])
  })

  it('recognises controller families', () => {
    expect(padKind('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox')
    expect(padKind('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation')
    expect(padKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox')
    expect(padKind('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation')
    expect(padKind('8BitDo Pro 2')).toBe('generic')
  })
})
