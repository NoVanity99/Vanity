import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
  leaving?: boolean
}

const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(() => {})

export function useToast(): (message: string, kind?: Toast['kind']) => void {
  return useContext(ToastContext)
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextId++
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 4300)
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'rounded-lg border px-4 py-2.5 text-sm shadow-xl backdrop-blur',
              t.leaving ? 'animate-[toast-out_200ms_ease-in_forwards]' : 'animate-[toast-in_220ms_cubic-bezier(0.2,0.7,0.2,1)]',
              t.kind === 'error' ? 'border-accent/40 bg-accent/15 text-text' : 'border-border bg-surface-2/95 text-text'
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
