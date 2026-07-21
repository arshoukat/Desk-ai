interface ProgressBricksProps {
  /** 0–100 */
  percent: number
  /** Number of brick segments. Defaults to 40. */
  segments?: number
}

/**
 * Segmented "brick" progress bar. Each brick lights up as the percentage
 * crosses its threshold, giving clear, granular feedback that work is
 * happening (as opposed to a single bar that can look frozen).
 */
export function ProgressBricks({ percent, segments = 40 }: ProgressBricksProps) {
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = (clamped / 100) * segments

  return (
    <div className="flex w-full items-center gap-[3px]" aria-hidden>
      {Array.from({ length: segments }, (_, i) => {
        const isFull = i + 1 <= Math.floor(filled)
        const isPartial = !isFull && i < filled
        return (
          <div
            key={i}
            className={[
              'h-3 flex-1 rounded-[2px] transition-all duration-200',
              isFull
                ? 'bg-teal shadow-[0_0_6px_rgba(45,212,191,0.5)]'
                : isPartial
                  ? 'animate-pulse bg-teal/60'
                  : 'bg-border/60',
            ].join(' ')}
          />
        )
      })}
    </div>
  )
}
