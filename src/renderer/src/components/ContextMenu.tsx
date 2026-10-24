import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export type MenuItem =
  | { type: 'separator' }
  | { label: string; icon?: LucideIcon; onSelect: () => void; disabled?: boolean; hint?: string; danger?: boolean }

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** A right-click menu at (x, y), kept inside the window. Closes on outside click, Escape, scroll or resize. */
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fixed z-50 min-w-52 animate-[menu-in_120ms_ease-out] rounded-xl border border-border bg-surface-2/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        'type' in item ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            title={item.hint}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              'enabled:hover:bg-white/8 disabled:cursor-default disabled:opacity-40',
              item.danger && 'enabled:hover:text-accent'
            )}
          >
            {item.icon && <item.icon className="size-4 text-muted" />}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
