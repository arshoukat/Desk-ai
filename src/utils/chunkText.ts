export interface ChunkOptions {
  chunkSize?: number
  chunkOverlap?: number
}

/**
 * Recursive character splitter: paragraphs → sentences → hard char split.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): string[] {
  const chunkSize = options.chunkSize ?? 500
  const chunkOverlap = options.chunkOverlap ?? 50

  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  if (normalized.length <= chunkSize) {
    return [normalized]
  }

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const pieces: string[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      pieces.push(paragraph)
      continue
    }

    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)

    let buffer = ''
    for (const sentence of sentences) {
      if (sentence.length > chunkSize) {
        if (buffer) {
          pieces.push(buffer)
          buffer = ''
        }
        pieces.push(...hardSplit(sentence, chunkSize, chunkOverlap))
        continue
      }

      const next = buffer ? `${buffer} ${sentence}` : sentence
      if (next.length <= chunkSize) {
        buffer = next
      } else {
        pieces.push(buffer)
        buffer = sentence
      }
    }
    if (buffer) pieces.push(buffer)
  }

  return mergeWithOverlap(pieces, chunkSize, chunkOverlap)
}

function hardSplit(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const parts: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    parts.push(text.slice(start, end))
    if (end >= text.length) break
    start = Math.max(0, end - chunkOverlap)
  }
  return parts
}

function mergeWithOverlap(
  pieces: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  if (pieces.length === 0) return []

  const chunks: string[] = []
  let current = ''

  for (const piece of pieces) {
    if (!current) {
      current = piece
      continue
    }
    const combined = `${current}\n\n${piece}`
    if (combined.length <= chunkSize) {
      current = combined
    } else {
      chunks.push(current)
      const overlapText =
        chunkOverlap > 0 ? current.slice(-chunkOverlap) : ''
      current = overlapText ? `${overlapText}\n\n${piece}` : piece
      if (current.length > chunkSize * 1.5) {
        // Avoid runaway growth from overlap + large piece
        current = piece
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}
