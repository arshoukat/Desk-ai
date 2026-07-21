/** Collapsible accordion for Qwen3 `<think>` reasoning traces. */
export function ThoughtProcess({
  thinking,
  streaming = false,
}: {
  thinking: string
  streaming?: boolean
}) {
  if (!thinking) return null
  return (
    <details className="mb-2 rounded-lg border border-border/70 bg-ink/40 open:bg-ink/50">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-muted transition hover:text-fg">
        {streaming ? 'Thinking…' : 'Thought Process'}
      </summary>
      <div className="whitespace-pre-wrap border-t border-border/60 px-3 py-2 font-mono text-xs leading-relaxed text-fg-subtle">
        {thinking}
      </div>
    </details>
  )
}
