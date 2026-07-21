import { useCallback, useState } from 'react'
import type { ExportPayload } from '../types/export'
import { buildFile, downloadBlob, formatLabel } from '../utils/fileExport'

interface ExportActionsProps {
  payload: ExportPayload
}

export function ExportActions({ payload }: ExportActionsProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDownload = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await buildFile(payload)
      downloadBlob(blob, payload.filename)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not build file for download.',
      )
    } finally {
      setBusy(false)
    }
  }, [payload])

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void onDownload()}
        className="rounded-lg bg-teal/15 px-3 py-1.5 text-xs font-semibold text-teal transition hover:bg-teal/25 disabled:opacity-50"
      >
        {busy
          ? 'Preparing file…'
          : `Download ${formatLabel(payload.format)}`}
      </button>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  )
}
