import { chunkText } from './chunkText'
import {
  countChunks,
  fetchChunksByDocId,
  fetchChunksByNumericIds,
  fetchRecentChunks,
  insertChunk,
  rebuildIndex,
  removeDocFromIndex,
  searchVectors,
  updateChunkEmbedding,
} from '../storage/vectorIndex'
import { getDb } from '../storage/db'
import type {
  DocumentSummary,
  EmbedWorkerRequest,
  EmbedWorkerResponse,
  SearchResult,
} from '../types/messages'
import type { ExportFormat } from '../types/export'

let worker: Worker | null = null
let requestCounter = 0

type Pending = {
  resolve: (value: EmbedWorkerResponse) => void
  reject: (reason: Error) => void
  onProgress?: (progress: number, status: string) => void
}

const pending = new Map<string, Pending>()

function getEmbeddingWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../workers/embedding.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (event: MessageEvent<EmbedWorkerResponse>) => {
      const data = event.data
      const entry = pending.get(data.requestId)
      if (!entry) return

      if (data.type === 'progress') {
        entry.onProgress?.(data.progress, data.status)
        return
      }

      pending.delete(data.requestId)
      if (data.type === 'error') {
        entry.reject(new Error(data.message))
      } else {
        entry.resolve(data)
      }
    }
    worker.onerror = (event) => {
      const message = event.message || 'Embedding worker crashed.'
      for (const [id, entry] of pending) {
        entry.reject(new Error(message))
        pending.delete(id)
      }
      worker = null
    }
  }
  return worker
}

function nextRequestId(): string {
  requestCounter += 1
  return `emb-${Date.now()}-${requestCounter}`
}

function postToWorker(
  message: EmbedWorkerRequest,
  onProgress?: (progress: number, status: string) => void,
): Promise<EmbedWorkerResponse> {
  const w = getEmbeddingWorker()
  return new Promise((resolve, reject) => {
    pending.set(message.requestId, { resolve, reject, onProgress })
    w.postMessage(message)
  })
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const line = content.items
      .map((item) => ('str' in item ? String(item.str) : ''))
      .join(' ')
    pages.push(line)
  }

  const text = pages.join('\n\n').trim()
  if (!text) {
    throw new Error('Could not extract text from this PDF.')
  }
  return text
}

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdfText(file)
  }
  if (
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    file.type.startsWith('text/')
  ) {
    return file.text()
  }
  throw new Error('Unsupported file type. Use .txt, .md, or .pdf.')
}

export async function embedTexts(
  texts: string[],
  onProgress?: (progress: number, status: string) => void,
): Promise<number[][]> {
  if (texts.length === 0) return []

  const requestId = nextRequestId()
  const response = await postToWorker(
    { type: 'embed', requestId, texts },
    onProgress,
  )

  if (response.type !== 'embed-result') {
    throw new Error('Unexpected embedding worker response.')
  }
  return response.embeddings
}

function newDocId(): string {
  return `doc-${crypto.randomUUID()}`
}

export async function ingestFile(
  file: File,
  threadId: string,
  onProgress?: (phase: string, progress: number) => void,
): Promise<DocumentSummary> {
  onProgress?.('Extracting text…', 5)
  const text = (await extractTextFromFile(file)).trim()
  if (!text) {
    throw new Error('File is empty or contains no readable text.')
  }

  onProgress?.('Chunking…', 15)
  const chunks = chunkText(text)
  if (chunks.length === 0) {
    throw new Error('No chunks produced from file.')
  }

  onProgress?.('Embedding…', 25)
  const embeddings = await embedTexts(chunks, (p, status) => {
    onProgress?.(status, 25 + Math.round(p * 0.6))
  })

  const docId = newDocId()
  const createdAt = Date.now()
  const db = await getDb()

  await db.exec({
    sql: `INSERT INTO documents (doc_id, thread_id, filename, chunk_count, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    bind: [docId, threadId, file.name, chunks.length, createdAt],
  })

  for (let i = 0; i < chunks.length; i++) {
    await insertChunk(
      `${docId}-${i}`,
      docId,
      threadId,
      file.name,
      chunks[i]!,
      embeddings[i]!,
      createdAt,
    )
  }

  await rebuildIndex()

  onProgress?.('Done', 100)
  return {
    docId,
    filename: file.name,
    chunkCount: chunks.length,
    createdAt,
  }
}

const VAGUE_QUERY =
  /\b(this|that|it|summarize|summary|overview|tell me about|describe|explain)\b/i

function isVagueQuery(query: string): boolean {
  return VAGUE_QUERY.test(query) && query.trim().split(/\s+/).length <= 8
}

async function fallbackSearchResults(
  k: number,
  query: string,
  threadId: string,
): Promise<SearchResult[]> {
  const total = await countChunks(threadId)
  if (total === 0) return []

  const limit = isVagueQuery(query) ? Math.min(total, Math.max(k * 3, 12)) : k
  const chunks = await fetchRecentChunks(limit, threadId)
  return chunks.map((chunk, i) => ({
    chunk,
    score: 1 - i * 0.001,
  }))
}

export async function search(
  query: string,
  threadId: string,
  k = 5,
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const [queryEmbedding] = await embedTexts([trimmed])
  if (!queryEmbedding) return []

  const hits = await searchVectors(queryEmbedding, k, threadId)
  if (hits.length > 0) {
    const chunks = await fetchChunksByNumericIds(hits.map((h) => h.numericId))
    if (chunks.length > 0) {
      return chunks.map((chunk, i) => {
        const raw = hits[i]?.score
        return {
          chunk,
          score: typeof raw === 'number' && Number.isFinite(raw) ? raw : 0,
        }
      })
    }
  }

  return fallbackSearchResults(k, trimmed, threadId)
}

export async function listDocuments(
  threadId: string,
): Promise<DocumentSummary[]> {
  const db = await getDb()
  const rows = await db.selectObjects<{
    doc_id: string
    filename: string
    chunk_count: number
    created_at: number
  }>(
    `SELECT doc_id, filename, chunk_count, created_at
     FROM documents WHERE thread_id IS ? ORDER BY created_at DESC`,
    [threadId],
  )

  return rows.map((r) => ({
    docId: r.doc_id,
    filename: r.filename,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
  }))
}

export async function deleteDocument(docId: string): Promise<void> {
  await removeDocFromIndex(docId)
  const db = await getDb()
  await db.exec({ sql: 'DELETE FROM chunks WHERE doc_id = ?', bind: docId })
  await db.exec({ sql: 'DELETE FROM documents WHERE doc_id = ?', bind: docId })
}

/** Concatenated chunk text for document preview. */
export async function getDocumentPreview(docId: string): Promise<{
  filename: string
  text: string
  chunkCount: number
}> {
  const chunks = await fetchChunksByDocId(docId)
  if (chunks.length === 0) {
    throw new Error('Document not found or has no text chunks.')
  }
  return {
    filename: chunks[0]!.filename,
    text: chunks.map((c) => c.text).join('\n\n'),
    chunkCount: chunks.length,
  }
}

/** Re-embed all chunks for a document (fixes corrupt embeddings after upgrades). */
export async function reembedDocument(
  docId: string,
  onProgress?: (phase: string, progress: number) => void,
): Promise<void> {
  const chunks = await fetchChunksByDocId(docId)
  if (chunks.length === 0) return
  onProgress?.('Re-embedding…', 10)
  const texts = chunks.map((c) => c.text)
  const embeddings = await embedTexts(texts, (p, status) => {
    onProgress?.(status, 10 + Math.round(p * 0.85))
  })
  for (let i = 0; i < chunks.length; i++) {
    await updateChunkEmbedding(chunks[i]!.id, embeddings[i]!)
  }
  await rebuildIndex()
  onProgress?.('Done', 100)
}

export async function reembedThreadDocuments(
  threadId: string,
  onProgress?: (phase: string, progress: number) => void,
): Promise<number> {
  const docs = await listDocuments(threadId)
  if (docs.length === 0) return 0
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!
    onProgress?.(
      `Re-embedding ${doc.filename} (${i + 1}/${docs.length})…`,
      Math.round((i / docs.length) * 100),
    )
    await reembedDocument(doc.docId, (phase, p) => {
      const overall = Math.round(((i + p / 100) / docs.length) * 100)
      onProgress?.(`${doc.filename}: ${phase}`, overall)
    })
  }
  onProgress?.('Done', 100)
  return docs.length
}

export function buildRagSystemPrompt(results: SearchResult[]): string {
  if (results.length === 0) {
    return [
      'You are Desk Ai, a private offline document assistant.',
      'No document text was retrieved for this question.',
      'If the user uploaded documents, tell them you could not find matching passages and suggest rephrasing or re-uploading.',
    ].join(' ')
  }

  const blocks = results.map((r, i) => {
    const source = r.chunk.filename
    return `[${i + 1}] From "${source}":\n${r.chunk.text}`
  })

  return [
    'You are Desk Ai, a private offline document assistant.',
    'The user uploaded these documents to their private vault on this device.',
    'Answer using the retrieved context below. Summarize names, employers, skills, and dates when asked.',
    'Do not refuse to discuss people or personal details that appear in the retrieved document text.',
    'When you reference a document, mention its filename naturally in your sentence (e.g., "According to AbdulRehman Shoukat CV.pdf, ...").',
    'Never output internal metadata such as scores, chunk numbers, or a raw "Source:" list with bracketed IDs. Do not invent numeric relevance scores.',
    'If the context is insufficient, say what is missing.',
    '',
    'Retrieved context:',
    blocks.join('\n\n---\n\n'),
  ].join('\n')
}

export function buildExportSystemAddendum(format: ExportFormat): string {
  const tableExample = JSON.stringify(
    {
      format,
      filename: 'expertise',
      columns: ['Area', 'Skills'],
      rows: [
        ['Deep Learning', 'LLM Fine-tuning'],
        ['NLP', 'RAG Pipelines'],
      ],
    },
    null,
    2,
  )

  const docxExample = JSON.stringify(
    {
      format: 'docx',
      filename: 'summary',
      title: 'Document Summary',
      sections: [
        { heading: 'Overview', body: 'Short paragraph from the vault.' },
        { heading: 'Skills', body: 'List key skills from context.' },
      ],
    },
    null,
    2,
  )

  const example = format === 'docx' ? docxExample : tableExample

  return [
    'The user wants a real downloadable file from Desk Ai (not code).',
    `Target format: ${format}.`,
    'Fill the export from retrieved context and chat history.',
    'Write one short confirmation sentence, then EXACTLY one fenced block like this:',
    '```vaultai-export',
    example,
    '```',
    'Rules:',
    '- NEVER write Python, pandas, shell, or any programming code.',
    '- NEVER invent fake download URLs or tell the user how to create the file themselves.',
    '- ONLY the vaultai-export JSON block creates the Download button in the UI.',
    format === 'docx'
      ? '- Use format "docx" with title and sections[{heading,body}].'
      : `- Use format "${format}" with columns (string[]) and rows (string[][]).`,
  ].join('\n')
}

export function buildFullSystemPrompt(
  results: SearchResult[],
  options?: {
    exportTurn?: boolean
    exportFormat?: ExportFormat
    priorSummary?: string
  },
): string {
  const parts = [buildRagSystemPrompt(results)]

  if (options?.priorSummary) {
    parts.push('', 'Prior conversation summary:', options.priorSummary)
  }

  if (options?.exportTurn) {
    const fmt = options.exportFormat ?? 'xlsx'
    parts.push('', buildExportSystemAddendum(fmt))
  }

  return parts.join('\n')
}
