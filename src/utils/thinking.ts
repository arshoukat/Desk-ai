/**
 * Qwen3 emits its chain-of-thought inside `<think> ... </think>` tags at the
 * start of a response. This parser splits that reasoning trace from the final
 * answer and is safe to call on partially-streamed text (the closing tag may
 * not have arrived yet).
 *
 * It also cleanly handles the empty `<think>\n\n</think>` prefix that WebLLM
 * injects when `enable_thinking: false` is used to suppress reasoning.
 */
export interface ParsedThinking {
  /** Reasoning trace between the think tags (may be empty). */
  thinking: string
  /** The user-facing answer with think tags removed. */
  answer: string
  /** True while a think block is open but not yet closed (mid-stream). */
  isThinking: boolean
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export function parseThinking(text: string): ParsedThinking {
  const openIdx = text.indexOf(THINK_OPEN)
  if (openIdx === -1) {
    return { thinking: '', answer: text.trimStart(), isThinking: false }
  }

  const afterOpen = openIdx + THINK_OPEN.length
  const closeIdx = text.indexOf(THINK_CLOSE, afterOpen)
  const before = text.slice(0, openIdx)

  if (closeIdx === -1) {
    return {
      thinking: text.slice(afterOpen).trim(),
      answer: before.trim(),
      isThinking: true,
    }
  }

  const thinking = text.slice(afterOpen, closeIdx).trim()
  const answer = (before + text.slice(closeIdx + THINK_CLOSE.length)).trim()
  return { thinking, answer, isThinking: false }
}

/** Convenience: strip any think trace and return only the answer text. */
export function stripThinking(text: string): string {
  return parseThinking(text).answer
}
