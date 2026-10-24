import { useCallback, useEffect, useState } from 'react'
import type { ScanProgress, ScanSummary } from '@shared/types'

export function useScan(onFinished?: (summary: ScanSummary) => void) {
  const [progress, setProgress] = useState<ScanProgress[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.vanity.scan.onProgress(setProgress), [])

  const start = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const summary = await window.vanity.scan.start()
      setProgress(summary.progress)
      onFinished?.(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [onFinished])

  return { progress, scanning, error, start }
}
