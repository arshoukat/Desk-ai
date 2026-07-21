import type { Citation } from '../types/citation'
import type { SearchResult } from '../types/messages'

export type { Citation }

export function citationsFromResults(results: SearchResult[]): Citation[] {
  return results.slice(0, 5).map((r) => ({
    filename: r.chunk.filename,
    excerpt: r.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 160),
    score:
      typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0,
  }))
}

export function CitationsList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null
  return (
    <details className="mt-3 rounded-lg border border-border/60 bg-ink/30">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-muted hover:text-fg">
        Sources ({citations.length})
      </summary>
      <ul className="space-y-2 border-t border-border/50 px-3 py-2">
        {citations.map((c, i) => (
          <li key={`${c.filename}-${i}`} className="text-xs leading-relaxed">
            <p className="font-medium text-teal/90">
              [{i + 1}] {c.filename}
            </p>
            <p className="mt-0.5 text-fg-subtle">
              “{c.excerpt}
              {c.excerpt.length >= 160 ? '…' : ''}”
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}
