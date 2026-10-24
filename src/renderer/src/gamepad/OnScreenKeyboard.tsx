import { useEffect, useMemo, useState } from 'react'
import { ArrowBigUp, CornerDownLeft, Delete, Space } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Action } from './input'

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_.@']
const SPECIAL = ['shift', 'space', 'backspace', 'done'] as const
type Special = (typeof SPECIAL)[number]

/** Writes a value into a React-controlled input so React sees the change. */
export function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

interface Props {
  target: HTMLInputElement | HTMLTextAreaElement
  onClose: (submit: boolean) => void
  /** Subscribe to controller actions while open; returns an unsubscribe. */
  subscribe: (handler: (a: Action) => boolean) => () => void
}

/** A controller-friendly keyboard for typing into text fields. */
export function OnScreenKeyboard({ target, onClose, subscribe }: Props): React.JSX.Element {
  const [shift, setShift] = useState(false)
  const [pos, setPos] = useState({ row: 1, col: 0 })
  const [value, setValue] = useState(target.value)
  const secret = target instanceof HTMLInputElement && target.type === 'password'

  // Rows of keys; the last row holds the four special keys.
  const grid = useMemo(() => [...ROWS.map((r) => [...r]), [...SPECIAL]], [])

  const write = (v: string): void => {
    setValue(v)
    setInputValue(target, v)
  }

  const press = (key: string | Special): void => {
    if (key === 'shift') setShift((s) => !s)
    else if (key === 'space') write(value + ' ')
    else if (key === 'backspace') write(value.slice(0, -1))
    else if (key === 'done') onClose(true)
    else {
      write(value + (shift ? key.toUpperCase() : key))
      if (shift) setShift(false)
    }
  }

  useEffect(
    () =>
      subscribe((a) => {
        const move = (dr: number, dc: number): void =>
          setPos((p) => {
            const row = Math.max(0, Math.min(grid.length - 1, p.row + dr))
            // Keep roughly the same horizontal position between rows of different lengths.
            const ratio = (p.col + 0.5) / grid[p.row].length
            const col = dr ? Math.min(grid[row].length - 1, Math.floor(ratio * grid[row].length)) : Math.max(0, Math.min(grid[row].length - 1, p.col + dc))
            return { row, col }
          })
        switch (a) {
          case 'up':
            move(-1, 0)
            break
          case 'down':
            move(1, 0)
            break
          case 'left':
            move(0, -1)
            break
          case 'right':
            move(0, 1)
            break
          case 'confirm':
            press(grid[pos.row][pos.col])
            break
          case 'options':
            press('backspace')
            break
          case 'search':
            press('space')
            break
          case 'prevTab':
          case 'nextTab':
            setShift((s) => !s)
            break
          case 'play':
            onClose(true)
            break
          case 'back':
            onClose(false)
            break
          default:
            break
        }
        return true // the keyboard takes every action while open
      }),
    [subscribe, grid, pos, value, shift] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const label = target.getAttribute('placeholder') || target.getAttribute('aria-label') || 'Type'

  return (
    <div className="animate-[fade-in_150ms_ease-out] fixed inset-0 z-[70] flex items-end justify-center bg-black/55 pb-10 backdrop-blur-sm">
      <div className="animate-[dialog-in_200ms_ease-out] w-[min(760px,92vw)] rounded-3xl border border-border bg-surface/95 p-5 shadow-2xl backdrop-blur-xl">
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-muted">{label}</p>
        <div className="mb-4 flex h-12 items-center rounded-xl bg-surface-2 px-4 text-lg ring-1 ring-border">
          <span className="truncate">{secret ? '•'.repeat(value.length) : value}</span>
          <span className="ml-0.5 h-6 w-0.5 animate-pulse bg-accent" />
        </div>
        <div className="space-y-2">
          {grid.map((row, r) => (
            <div key={r} className="flex justify-center gap-2">
              {row.map((key, c) => {
                const focused = pos.row === r && pos.col === c
                const special = (SPECIAL as readonly string[]).includes(key)
                return (
                  <button
                    key={key}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => press(key)}
                    className={cn(
                      'flex h-12 items-center justify-center rounded-xl text-lg font-semibold transition duration-100',
                      special ? 'flex-1 gap-2 text-sm' : 'w-12',
                      focused ? 'scale-110 bg-accent text-white shadow-lg shadow-accent/40' : 'bg-surface-2 text-text hover:bg-white/10',
                      key === 'shift' && shift && !focused && 'bg-accent/25'
                    )}
                  >
                    {key === 'shift' ? (
                      <>
                        <ArrowBigUp className="size-5" /> Shift
                      </>
                    ) : key === 'space' ? (
                      <>
                        <Space className="size-5" /> Space
                      </>
                    ) : key === 'backspace' ? (
                      <>
                        <Delete className="size-5" /> Delete
                      </>
                    ) : key === 'done' ? (
                      <>
                        <CornerDownLeft className="size-5" /> Done
                      </>
                    ) : shift ? (
                      key.toUpperCase()
                    ) : (
                      key
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
