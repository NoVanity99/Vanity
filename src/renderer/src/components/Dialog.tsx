import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-[fade-in_150ms_ease-out] items-center justify-center bg-black/70 p-8 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          'flex max-h-full w-full animate-[dialog-in_180ms_ease-out] flex-col rounded-2xl border border-border bg-surface shadow-2xl',
          SIZES[size],
          className
        )}
      >
        <div className="border-b border-border p-6">
          <h2 className="text-xl font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
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
