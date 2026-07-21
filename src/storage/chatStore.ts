import { getDb } from './db'
import { invalidateVectorIndex } from './vectorIndex'
import type { Citation } from '../types/citation'

export interface ThreadRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface MessageRecord {
  id: string
  threadId: string
  role: 'user' | 'assistant'
  content: string
  isExportReply: boolean
  citations: Citation[]
  createdAt: number
}

function parseCitations(raw: string | null | undefined): Citation[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Citation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const ACTIVE_THREAD_KEY = 'vaultai_active_thread'

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function toThreadRecord(row: {
  id: string
  title: string
  created_at: number
  updated_at: number
}): ThreadRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getActiveThreadId(): string | null {
  return localStorage.getItem(ACTIVE_THREAD_KEY)
}

export function setActiveThreadId(threadId: string): void {
  localStorage.setItem(ACTIVE_THREAD_KEY, threadId)
}

export async function listThreads(): Promise<ThreadRecord[]> {
  const db = await getDb()
  const rows = await db.selectObjects<{
    id: string
    title: string
    created_at: number
    updated_at: number
  }>(
    `SELECT id, title, created_at, updated_at FROM threads
     ORDER BY updated_at DESC`,
  )
  return rows.map(toThreadRecord)
}

export async function createThread(
  title = 'New chat',
): Promise<ThreadRecord> {
  const db = await getDb()
  const now = Date.now()
  const id = newId('thread')
  await db.exec({
    sql: `INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    bind: [id, title, now, now],
  })
  setActiveThreadId(id)
  return { id, title, createdAt: now, updatedAt: now }
}

/** True when a thread has no messages yet. */
export async function isThreadEmpty(threadId: string): Promise<boolean> {
  const db = await getDb()
  const count = await db.selectValue(
    'SELECT COUNT(*) FROM messages WHERE thread_id = ?',
    [threadId],
  )
  return Number(count) === 0
}

/**
 * Returns the most recently updated empty thread, if any.
 * Also deletes older duplicate empty chats so only one blank chat remains.
 */
export async function findOrPruneEmptyThread(): Promise<ThreadRecord | null> {
  const threads = await listThreads()
  const empties: ThreadRecord[] = []
  for (const t of threads) {
    if (await isThreadEmpty(t.id)) empties.push(t)
  }
  if (empties.length === 0) return null

  // Keep the newest empty chat; remove the rest.
  const [keep, ...dupes] = empties
  for (const d of dupes) {
    await deleteThreadCascade(d.id)
  }
  return keep ?? null
}

export async function getThread(id: string): Promise<ThreadRecord | null> {
  const db = await getDb()
  const row = await db.selectObject<{
    id: string
    title: string
    created_at: number
    updated_at: number
  }>('SELECT id, title, created_at, updated_at FROM threads WHERE id = ?', id)

  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function updateThreadTitle(
  threadId: string,
  title: string,
): Promise<void> {
  const db = await getDb()
  const trimmed = title.trim().slice(0, 80) || 'New chat'
  await db.exec({
    sql: 'UPDATE threads SET title = ?, updated_at = ? WHERE id = ?',
    bind: [trimmed, Date.now(), threadId],
  })
}

export async function appendMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  options?: { isExportReply?: boolean; citations?: Citation[] },
): Promise<MessageRecord> {
  const db = await getDb()
  const now = Date.now()
  const id = newId('msg')
  const isExportReply = options?.isExportReply ? 1 : 0
  const citations = options?.citations ?? []
  const citationsJson =
    citations.length > 0 ? JSON.stringify(citations) : null

  await db.exec({
    sql: `INSERT INTO messages (id, thread_id, role, content, is_export_reply, citations_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    bind: [id, threadId, role, content, isExportReply, citationsJson, now],
  })
  await db.exec({
    sql: 'UPDATE threads SET updated_at = ? WHERE id = ?',
    bind: [now, threadId],
  })

  return {
    id,
    threadId,
    role,
    content,
    isExportReply: Boolean(options?.isExportReply),
    citations,
    createdAt: now,
  }
}

export async function listMessages(
  threadId: string,
  options?: { limit?: number; before?: number },
): Promise<MessageRecord[]> {
  const db = await getDb()
  const limit = options?.limit ?? 50

  let rows: {
    id: string
    thread_id: string
    role: string
    content: string
    is_export_reply: number
    citations_json: string | null
    created_at: number
  }[]

  if (options?.before != null) {
    rows = await db.selectObjects(
      `SELECT id, thread_id, role, content, is_export_reply, citations_json, created_at
       FROM messages WHERE thread_id = ? AND created_at < ?
       ORDER BY created_at DESC LIMIT ?`,
      [threadId, options.before, limit],
    )
  } else {
    rows = await db.selectObjects(
      `SELECT id, thread_id, role, content, is_export_reply, citations_json, created_at
       FROM messages WHERE thread_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [threadId, limit],
    )
  }

  return rows.reverse().map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    isExportReply: r.is_export_reply === 1,
    citations: parseCitations(r.citations_json),
    createdAt: r.created_at,
  }))
}

export async function listAllMessagesForPrompt(
  threadId: string,
): Promise<MessageRecord[]> {
  const db = await getDb()
  const rows = await db.selectObjects<{
    id: string
    thread_id: string
    role: string
    content: string
    is_export_reply: number
    citations_json: string | null
    created_at: number
  }>(
    `SELECT id, thread_id, role, content, is_export_reply, citations_json, created_at
     FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
    threadId,
  )

  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    isExportReply: r.is_export_reply === 1,
    citations: parseCitations(r.citations_json),
    createdAt: r.created_at,
  }))
}

/**
 * Deletes a chat and everything scoped to it: messages, and its per-chat
 * documents and vector chunks.
 */
export async function deleteThreadCascade(threadId: string): Promise<void> {
  const db = await getDb()
  await db.exec({
    sql: 'DELETE FROM chunks WHERE thread_id IS ?',
    bind: [threadId],
  })
  await db.exec({
    sql: 'DELETE FROM documents WHERE thread_id IS ?',
    bind: [threadId],
  })
  await db.exec({
    sql: 'DELETE FROM messages WHERE thread_id = ?',
    bind: [threadId],
  })
  await db.exec({ sql: 'DELETE FROM threads WHERE id = ?', bind: [threadId] })
  invalidateVectorIndex()
  if (getActiveThreadId() === threadId) {
    localStorage.removeItem(ACTIVE_THREAD_KEY)
  }
}

/** Module-level latch so StrictMode double-mount does not create two empty chats. */
let ensureActivePromise: Promise<ThreadRecord> | null = null

export async function getOrCreateActiveThread(): Promise<ThreadRecord> {
  if (!ensureActivePromise) {
    ensureActivePromise = (async () => {
      try {
        const stored = getActiveThreadId()
        if (stored) {
          const thread = await getThread(stored)
          if (thread) return thread
        }

        const existing = await listThreads()
        if (existing[0]) {
          setActiveThreadId(existing[0].id)
          return existing[0]
        }

        return createThread()
      } finally {
        ensureActivePromise = null
      }
    })()
  }
  return ensureActivePromise
}

export async function getOlderMessageSummary(
  threadId: string,
  beforeCount: number,
): Promise<string> {
  const db = await getDb()
  const rows = await db.selectObjects<{ role: string; content: string }>(
    `SELECT role, content FROM messages WHERE thread_id = ?
     ORDER BY created_at ASC LIMIT ?`,
    [threadId, beforeCount],
  )

  if (rows.length === 0) return ''
  return rows
    .map((r) => {
      const body =
        r.content.length > 500 ? `${r.content.slice(0, 500)}…` : r.content
      return `${r.role}: ${body}`
    })
    .join('\n')
}
