import { useEffect } from 'react'

interface DocPreviewModalProps {
  filename: string
  text: string
  chunkCount: number
  onClose: () => void
}

export function DocPreviewModal({
  filename,
  text,
  chunkCount,
  onClose,
}: DocPreviewModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-preview-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-slate-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="doc-preview-title"
              className="truncate font-display text-lg font-semibold text-fg-strong"
            >
              {filename}
            </h2>
            <p className="mt-0.5 text-xs text-slate-muted">
              {chunkCount} chunk{chunkCount === 1 ? '' : 's'} · stored on this
              device
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-muted hover:text-fg-strong"
          >
            Close
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-fg">
          {text}
        </pre>
      </div>
    </div>
  )
}
