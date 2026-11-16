import { useCallback, useEffect, useRef, useState } from 'react'
import { moveTab, type TabId } from '@shared/interfaceOptions'

const HOLD_MS = 300
/** Moving this far before the hold is up means scrolling or a click, not a drag. */
const SLOP_PX = 6

export interface TabDrag {
  /** The tab being dragged, how far it has moved (px), and where it would land. */
  dragging: { id: TabId; dy: number; to: number; from: number; step: number } | null
  /** Put on each tab's wrapper. */
  bind(id: TabId, index: number): { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onDragStart: (e: React.DragEvent<HTMLElement>) => void; 'data-tab': TabId }
  /** How far a tab shifts to make room (px). */
  shiftOf(index: number): number
}

/**
 * Press and hold a sidebar tab, then drag it up or down to move it. A quick click still opens
 * the tab, and a quick move still scrolls; only a hold starts a drag. The new order is passed to
 * `onDrop` (which saves it).
 */
export function useTabDrag(order: TabId[], visible: TabId[], onDrop: (next: TabId[]) => void): TabDrag {
  const [dragging, setDragging] = useState<TabDrag['dragging']>(null)
  const live = useRef<TabDrag['dragging']>(null)
  live.current = dragging
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  const bind = useCallback(
    (id: TabId, index: number) => ({
      'data-tab': id,
      // Links can be dragged out by the browser itself, which would cancel this drag.
      onDragStart: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return
        const el = e.currentTarget
        const list = el.parentElement
        const startY = e.clientY
        let started = false
        let tops: number[] = []
        let step = 0
        const timer = setTimeout(() => {
          started = true
          const items = [...(list?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])]
          tops = items.map((x) => x.getBoundingClientRect().top + x.offsetHeight / 2)
          step = items.length > 1 ? items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top : el.offsetHeight
          try {
            el.setPointerCapture(e.pointerId)
          } catch {
            // Released meanwhile.
          }
          navigator.vibrate?.(15)
          setDragging({ id, dy: 0, to: index, from: index, step })
        }, HOLD_MS)
        const move = (ev: PointerEvent): void => {
          const dy = ev.clientY - startY
          if (!started) {
            if (Math.abs(dy) > SLOP_PX) stop()
            return
          }
          ev.preventDefault()
          const y = tops[index] + dy
          let to = 0
          while (to < tops.length - 1 && y > (tops[to] + tops[to + 1]) / 2) to++
          setDragging({ id, dy, to, from: index, step })
        }
        const up = (): void => {
          const d = live.current
          stop()
          if (!started || !d) return
          // The drop must not also open the tab.
          const block = (ce: MouseEvent): void => {
            ce.preventDefault()
            ce.stopPropagation()
          }
          window.addEventListener('click', block, { capture: true, once: true })
          setTimeout(() => window.removeEventListener('click', block, { capture: true }), 50)
          setDragging(null)
          if (d.to === d.from) return
          // `to` is a place among the tabs on screen; turn it into a place in the full order (hidden ones included).
          const target = visible[d.to]
          const without = order.filter((t) => t !== id)
          const at = d.to > d.from ? without.indexOf(target) + 1 : without.indexOf(target)
          onDrop(moveTab(order, id, at))
        }
        // A long press on a touch screen also asks for the tab's menu: not while dragging.
        const noMenu = (ce: Event): void => {
          if (started) ce.preventDefault()
        }
        const stop = (): void => {
          clearTimeout(timer)
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          el.removeEventListener('contextmenu', noMenu, true)
          cleanup.current = null
        }
        window.addEventListener('pointermove', move, { passive: false })
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
        el.addEventListener('contextmenu', noMenu, true)
        cleanup.current = stop
      }
    }),
    [order, visible, onDrop]
  )

  const shiftOf = useCallback(
    (index: number): number => {
      const d = dragging
      if (!d || index === d.from) return 0
      if (d.from < d.to && index > d.from && index <= d.to) return -d.step
      if (d.from > d.to && index >= d.to && index < d.from) return d.step
      return 0
    },
    [dragging]
  )

  return { dragging, bind, shiftOf }
}
