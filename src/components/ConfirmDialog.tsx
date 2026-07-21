import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** In-app confirmation — more reliable than window.confirm for destructive actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-slate-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-title"
          className="font-display text-lg font-semibold text-fg-strong"
        >
          {title}
        </h2>
        <p id="confirm-desc" className="mt-2 text-sm leading-relaxed text-slate-muted">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-border px-4 py-2 text-sm text-fg-subtle transition hover:border-teal/40 hover:text-fg-strong"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              'rounded-xl px-4 py-2 text-sm font-semibold transition',
              danger
                ? 'bg-red-500/90 text-white hover:bg-red-500'
                : 'bg-teal text-ink hover:bg-teal-dim',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
