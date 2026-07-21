import { useState, type FormEvent } from 'react'
import { MARKETING_URL } from '../utils/license'

interface ActivationScreenProps {
  error: string | null
  isActivating: boolean
  onActivate: (key: string) => Promise<void>
  onContinueFree: () => void
}

export function ActivationScreen({
  error,
  isActivating,
  onActivate,
  onContinueFree,
}: ActivationScreenProps) {
  const [key, setKey] = useState('')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void onActivate(key)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <p className="font-display text-3xl font-semibold tracking-tight text-fg-strong">
          Desk Ai
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-muted">
          Private document Q&amp;A on this device. Start free with one temporary
          chat, or unlock the full app with a license.
        </p>

        <button
          type="button"
          onClick={onContinueFree}
          disabled={isActivating}
          className="mt-8 w-full rounded-xl border border-border bg-surface/80 px-4 py-3 text-sm font-semibold text-fg transition hover:border-teal/40 hover:bg-surface disabled:opacity-50"
        >
          Continue free
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-muted">
          One chat · one document · no saved history · clears when you reload ·
          no backups
        </p>

        <div className="my-8 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-slate-muted">
            or unlock full
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-muted">
              License key
            </span>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              disabled={isActivating}
              className="mt-1.5 w-full rounded-xl border border-border bg-slate-panel/80 px-4 py-3 font-mono text-sm text-fg outline-none transition placeholder:text-slate-muted/60 focus:border-teal/50 disabled:opacity-50"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-300/95">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isActivating || !key.trim()}
            className="w-full rounded-xl bg-teal px-4 py-3 text-sm font-semibold text-ink transition hover:bg-teal-dim disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isActivating ? 'Activating…' : 'Activate full Desk Ai'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-muted">
          Need a key?{' '}
          <a
            href={MARKETING_URL}
            target="_blank"
            rel="noreferrer"
            className="text-teal underline-offset-2 hover:underline"
          >
            Buy Desk Ai
          </a>
        </p>
      </div>
    </div>
  )
}
