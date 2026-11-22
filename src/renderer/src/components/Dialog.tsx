import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** The dialogs on screen, in the order they opened. */
const open: object[] = []

const SIZES = { md: 'max-w-lg', lg: 'max-w-xl', xl: 'max-w-2xl', '2xl': 'max-w-4xl' } as const

interface Props {
  size?: keyof typeof SIZES
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Dialog({ size = 'md', title, description, onClose, children, footer, className }: Props): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  // With a controller, start on the first control inside the dialog (unless something already has focus there).
  useEffect(() => {
    const t = setTimeout(() => {
      if (!document.documentElement.classList.contains('gamepad-mode') || panel.current?.contains(document.activeElement)) return
      panel.current?.querySelector<HTMLElement>('input, button:not([aria-label="Close"]):not([disabled]), [role="button"]')?.focus()
    }, 50)
    return () => clearTimeout(t)
  }, [])

  // Escape closes the dialog on top only (a dialog opened from another one closes first).
  const me = useRef<object>({})
  useEffect(() => {
    const token = me.current
    open.push(token)
    return () => void open.splice(open.indexOf(token), 1)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open[open.length - 1] === me.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-[fade-in_150ms_ease-out] items-center justify-center bg-black/70 p-8 backdrop-blur-sm max-md:p-3 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:pt-[calc(0.75rem+env(safe-area-inset-top))]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-label={title}
        className={cn(
          'flex max-h-full w-full animate-[dialog-in_180ms_ease-out] flex-col rounded-2xl border border-border bg-surface shadow-2xl',
          SIZES[size],
          className
        )}
      >
        <div className="flex items-start gap-4 border-b border-border p-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-m-1.5 rounded-lg p-1.5 text-muted transition hover:bg-white/8 hover:text-text"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-border p-4">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }): React.JSX.Element {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        variant === 'primary' && 'bg-accent font-semibold text-white hover:brightness-110',
        variant === 'secondary' && 'border border-border bg-surface-2 hover:border-white/20 hover:bg-white/8',
        variant === 'ghost' && 'text-muted hover:text-text',
        className
      )}
    />
  )
}
