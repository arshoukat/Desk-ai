import type { ExportFormat, ExportPayload } from '../types/export'

const EXPORT_INTENT =
  /\b(excel|xlsx|csv|spreadsheet|word|docx|download|export|save\s+as|give\s+me\s+(an?\s+)?(excel|xlsx|csv|word|docx|spreadsheet)|save\s+that\s+as|generate\s+(an?\s+)?(excel|xlsx|csv|word|docx|file)|as\s+a\s+(csv|xlsx|excel|word|docx))\b/i

const EXPORT_BLOCK_RE = /```vaultai-export\s*([\s\S]*?)```/i

export function detectExportIntent(query: string): boolean {
  return EXPORT_INTENT.test(query)
}

export function detectExportFormat(query: string): ExportFormat {
  const q = query.toLowerCase()
  if (/\b(csv)\b/.test(q)) return 'csv'
  if (/\b(word|docx)\b/.test(q)) return 'docx'
  return 'xlsx'
}

export function parseExportBlock(markdown: string): ExportPayload | null {
  const match = EXPORT_BLOCK_RE.exec(markdown)
  if (!match?.[1]) return null

  try {
    const raw = JSON.parse(match[1].trim()) as ExportPayload
    if (!raw.format || !raw.filename) return null

    if (raw.format === 'docx') {
      if (!raw.title || !Array.isArray(raw.sections)) return null
      return raw
    }

    if (raw.format === 'csv' || raw.format === 'xlsx') {
      if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null
      return raw
    }
    return null
  } catch {
    return null
  }
}

export function stripExportBlock(markdown: string): string {
  return markdown.replace(EXPORT_BLOCK_RE, '').trim()
}
