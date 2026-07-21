import { getDb } from './db'
import type { DocChunk } from '../types/messages'

const embeddingCache = new Map<number, Float32Array>()
/** numeric_id → owning thread_id (null for legacy/global chunks). */
const chunkThread = new Map<number, string | null>()

function embeddingToFloat32(blob: Uint8Array | null): Float32Array {
  if (!blob || blob.byteLength === 0) return new Float32Array(0)
  const copy = new Uint8Array(blob)
  return new Float32Array(
    copy.buffer,
    copy.byteOffset,
    copy.byteLength / 4,
  )
}

function float32ToBlob(vec: number[] | Float32Array): Uint8Array {
  const arr = vec instanceof Float32Array ? vec : new Float32Array(vec)
  // Byte view of the Float32 buffer — NOT element-wise Uint8 conversion.
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  return Number(value)
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Bumped whenever the chunk set changes so the in-memory cache reloads. */
let indexGeneration = 0
let loadedGeneration = -1

export function invalidateVectorIndex(): void {
  indexGeneration += 1
  embeddingCache.clear()
  chunkThread.clear()
  loadedGeneration = -1
}

export async function ensureVectorIndex(): Promise<void> {
  const db = await getDb()
  const count = asNumber(await db.selectValue('SELECT COUNT(*) FROM chunks'))
  if (count === 0) {
    embeddingCache.clear()
    chunkThread.clear()
    loadedGeneration = indexGeneration
    return
  }
  if (loadedGeneration === indexGeneration && embeddingCache.size > 0) return

  embeddingCache.clear()
  chunkThread.clear()
  const rows = await db.selectObjects<{
    numeric_id: number | bigint
    thread_id: string | null
    embedding: Uint8Array | null
  }>('SELECT numeric_id, thread_id, embedding FROM chunks ORDER BY numeric_id')

  for (const row of rows) {
    const numericId = asNumber(row.numeric_id)
    const vec = embeddingToFloat32(row.embedding)
    if (vec.length > 0) {
      embeddingCache.set(numericId, vec)
      chunkThread.set(numericId, row.thread_id ?? null)
    }
  }
  loadedGeneration = indexGeneration
}

export async function addChunkToIndex(
  numericId: number,
  embedding: number[],
  threadId: string | null,
): Promise<void> {
  await ensureVectorIndex()
  embeddingCache.set(numericId, new Float32Array(embedding))
  chunkThread.set(numericId, threadId)
}

export async function removeDocFromIndex(docId: string): Promise<void> {
  const db = await getDb()
  const rows = await db.selectObjects<{ numeric_id: number | bigint }>(
    'SELECT numeric_id FROM chunks WHERE doc_id = ?',
    docId,
  )

  for (const row of rows) {
    const numericId = asNumber(row.numeric_id)
    embeddingCache.delete(numericId)
    chunkThread.delete(numericId)
  }
  indexGeneration += 1
  loadedGeneration = -1
}

export async function searchVectors(
  queryEmbedding: number[],
  k: number,
  threadId?: string | null,
): Promise<{ numericId: number; score: number }[]> {
  await ensureVectorIndex()
  if (embeddingCache.size === 0) return []

  const query = new Float32Array(queryEmbedding)
  const scored: { numericId: number; score: number }[] = []

  for (const [numericId, vec] of embeddingCache) {
    if (threadId !== undefined && chunkThread.get(numericId) !== threadId) {
      continue
    }
    scored.push({ numericId, score: cosineSimilarity(query, vec) })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

export async function fetchChunksByNumericIds(
  numericIds: number[],
): Promise<DocChunk[]> {
  if (numericIds.length === 0) return []
  const db = await getDb()
  const placeholders = numericIds.map(() => '?').join(',')
  const rows = await db.selectObjects<{
    id: string
    doc_id: string
    filename: string
    text: string
    embedding: Uint8Array
    created_at: number
    numeric_id: number
  }>(
    `SELECT id, doc_id, filename, text, embedding, created_at, numeric_id
     FROM chunks WHERE numeric_id IN (${placeholders})`,
    numericIds,
  )

  const byNumeric = new Map(rows.map((r) => [r.numeric_id, r]))
  return numericIds
    .map((nid) => byNumeric.get(nid))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({
      id: r.id,
      docId: r.doc_id,
      filename: r.filename,
      text: r.text,
      embedding: Array.from(embeddingToFloat32(r.embedding)),
      createdAt: r.created_at,
    }))
}

export async function fetchChunksByDocId(docId: string): Promise<DocChunk[]> {
  const db = await getDb()
  const rows = await db.selectObjects<{
    id: string
    doc_id: string
    filename: string
    text: string
    embedding: Uint8Array | null
    created_at: number
    numeric_id: number | bigint
  }>(
    `SELECT id, doc_id, filename, text, embedding, created_at, numeric_id
     FROM chunks WHERE doc_id = ? ORDER BY numeric_id ASC`,
    docId,
  )
  return rows.map((r) => ({
    id: r.id,
    docId: r.doc_id,
    filename: r.filename,
    text: r.text,
    embedding: Array.from(embeddingToFloat32(r.embedding)),
    createdAt: r.created_at,
  }))
}

export async function updateChunkEmbedding(
  chunkId: string,
  embedding: number[],
): Promise<void> {
  const db = await getDb()
  await db.exec({
    sql: 'UPDATE chunks SET embedding = ? WHERE id = ?',
    bind: [float32ToBlob(embedding), chunkId],
  })
  indexGeneration += 1
  loadedGeneration = -1
}

export async function insertChunk(
  id: string,
  docId: string,
  threadId: string | null,
  filename: string,
  text: string,
  embedding: number[],
  createdAt: number,
): Promise<number> {
  const db = await getDb()
  const numericId = asNumber(
    await db.execReturningLastId({
      sql: `INSERT INTO chunks (id, doc_id, thread_id, filename, text, embedding, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bind: [
        id,
        docId,
        threadId,
        filename,
        text,
        float32ToBlob(embedding),
        createdAt,
      ],
    }),
  )
  await addChunkToIndex(numericId, embedding, threadId)
  return numericId
}

export async function fetchRecentChunks(
  limit: number,
  threadId?: string | null,
): Promise<DocChunk[]> {
  if (limit <= 0) return []
  const db = await getDb()
  const rows = (
    threadId !== undefined
      ? await db.selectObjects<{
          id: string
          doc_id: string
          filename: string
          text: string
          embedding: Uint8Array | null
          created_at: number
          numeric_id: number
        }>(
          `SELECT id, doc_id, filename, text, embedding, created_at, numeric_id
           FROM chunks WHERE thread_id IS ? ORDER BY numeric_id ASC LIMIT ?`,
          [threadId, limit],
        )
      : await db.selectObjects<{
          id: string
          doc_id: string
          filename: string
          text: string
          embedding: Uint8Array | null
          created_at: number
          numeric_id: number
        }>(
          `SELECT id, doc_id, filename, text, embedding, created_at, numeric_id
           FROM chunks ORDER BY numeric_id ASC LIMIT ?`,
          [limit],
        )
  )

  return rows.map((r) => ({
    id: r.id,
    docId: r.doc_id,
    filename: r.filename,
    text: r.text,
    embedding: Array.from(embeddingToFloat32(r.embedding)),
    createdAt: r.created_at,
  }))
}

export async function countChunks(threadId?: string | null): Promise<number> {
  const db = await getDb()
  if (threadId !== undefined) {
    return asNumber(
      await db.selectValue(
        'SELECT COUNT(*) FROM chunks WHERE thread_id IS ?',
        [threadId],
      ),
    )
  }
  return asNumber(await db.selectValue('SELECT COUNT(*) FROM chunks'))
}

export async function rebuildIndex(): Promise<void> {
  invalidateVectorIndex()
  await ensureVectorIndex()
}
