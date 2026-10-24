/** Turns Gamepad API polling into discrete actions (with key-repeat) plus a continuous scroll value. */

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'options'
  | 'search'
  | 'prevTab'
  | 'nextTab'
  | 'pageUp'
  | 'pageDown'
  | 'play'
  | 'view'

/** Standard-mapping button indexes (https://w3c.github.io/gamepad/#remapping). */
const BUTTON_ACTIONS: [number, Action][] = [
  [0, 'confirm'], // A / Cross
  [1, 'back'], // B / Circle
  [2, 'options'], // X / Square
  [3, 'search'], // Y / Triangle
  [4, 'prevTab'], // LB
  [5, 'nextTab'], // RB
  [8, 'view'], // Back / View / Share
  [9, 'play'] // Start / Menu / Options
]
const REPEATING: [number, Action][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [6, 'pageUp'], // LT
  [7, 'pageDown'] // RT
]

const STICK_THRESHOLD = 0.55
const SCROLL_DEADZONE = 0.2
const REPEAT_DELAY = 380
const REPEAT_RATE = 110

export type PadKind = 'xbox' | 'playstation' | 'generic'

export function padKind(id: string): PadKind {
  // Xbox first: "Xbox Wireless Controller" would otherwise match PlayStation's "Wireless Controller".
  if (/xbox|xinput|045e/i.test(id)) return 'xbox'
  if (/054c|dualsense|dualshock|playstation|wireless controller/i.test(id)) return 'playstation'
  return 'generic'
}

export interface PadSnapshot {
  id: string
  buttons: readonly { pressed: boolean; value: number }[]
  axes: readonly number[]
}

export class GamepadInput {
  private held = new Map<Action, { since: number; last: number }>()
  private pressed = new Set<number>()

  constructor(
    private onAction: (a: Action) => void,
    private onScroll: (dx: number, dy: number) => void
  ) {}

  /** Feed one poll of the first connected pad (or null). Returns the pad's id. */
  update(pad: PadSnapshot | null, now: number): string | null {
    if (!pad) {
      this.held.clear()
      this.pressed.clear()
      return null
    }
    const isDown = (i: number): boolean => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5

    // Edge-triggered buttons: act once per press.
    for (const [i, action] of BUTTON_ACTIONS) {
      if (isDown(i)) {
        if (!this.pressed.has(i)) {
          this.pressed.add(i)
          this.onAction(action)
        }
      } else this.pressed.delete(i)
    }

    // Directions and triggers repeat while held (D-pad or left stick).
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes
    const active = new Set<Action>()
    for (const [i, action] of REPEATING) if (isDown(i)) active.add(action)
    if (ly < -STICK_THRESHOLD) active.add('up')
    if (ly > STICK_THRESHOLD) active.add('down')
    if (lx < -STICK_THRESHOLD) active.add('left')
    if (lx > STICK_THRESHOLD) active.add('right')
    for (const action of active) {
      const h = this.held.get(action)
      if (!h) {
        this.held.set(action, { since: now, last: now })
        this.onAction(action)
      } else if (now - h.since >= REPEAT_DELAY && now - h.last >= REPEAT_RATE) {
        h.last = now
        this.onAction(action)
      }
    }
    for (const action of [...this.held.keys()]) if (!active.has(action)) this.held.delete(action)

    // Right stick scrolls continuously.
    const sx = Math.abs(rx) > SCROLL_DEADZONE ? rx : 0
    const sy = Math.abs(ry) > SCROLL_DEADZONE ? ry : 0
    if (sx || sy) this.onScroll(sx, sy)
    return pad.id
  }
}
