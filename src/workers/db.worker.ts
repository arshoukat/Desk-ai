/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

/**
 * Dedicated SQLite worker. OPFS SAHPool persists chats across reloads.
 * Holds an exclusive Web Lock + closes cleanly on shutdown so HMR/reloads
 * do not leave orphaned SyncAccessHandles.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteDb = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sqlite3 = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoolUtil = any

export type DbRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'shutdown' }
  | { id: number; type: 'exportBackup' }
  | { id: number; type: 'importBackup'; bytes: Uint8Array }
  | {
      id: number
      type: 'exec'
      sql: string
      bind?: unknown
    }
  | {
      id: number
      type: 'execReturningLastId'
      sql: string
      bind?: unknown
    }
  | {
      id: number
      type: 'selectObjects'
      sql: string
      bind?: unknown
    }
  | {
      id: number
      type: 'selectObject'
      sql: string
      bind?: unknown
    }
  | {
      id: number
      type: 'selectValue'
      sql: string
      bind?: unknown
    }

export type DbRequestPayload =
  | { type: 'init' }
  | { type: 'shutdown' }
  | { type: 'exportBackup' }
  | { type: 'importBackup'; bytes: Uint8Array }
  | { type: 'exec'; sql: string; bind?: unknown }
  | { type: 'execReturningLastId'; sql: string; bind?: unknown }
  | { type: 'selectObjects'; sql: string; bind?: unknown }
  | { type: 'selectObject'; sql: string; bind?: unknown }
  | { type: 'selectValue'; sql: string; bind?: unknown }

export type DbResponse =
  | {
      id: number
      ok: true
      result?: unknown
      persistent?: boolean
      backend?: string
      error?: string
    }
  | { id: number; ok: false; error: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  is_export_reply INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  thread_id TEXT,
  filename TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  numeric_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  doc_id TEXT NOT NULL,
  thread_id TEXT,
  filename TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_documents_thread ON documents(thread_id);
CREATE INDEX IF NOT EXISTS idx_chunks_thread ON chunks(thread_id);
`

const WEB_LOCK_NAME = 'vaultai-sqlite-opfs'

let db: SqliteDb | null = null
let sqlite3Ref: Sqlite3 | null = null
let poolUtil: PoolUtil | null = null
let persistent = false
let backend = 'none'
let initError: string | undefined
let initPromise: Promise<void> | null = null
let releaseWebLock: (() => void) | null = null

function columnExists(database: SqliteDb, table: string, column: string): boolean {
  const rows = database.selectObjects(`PRAGMA table_info(${table})`) as {
    name: string
  }[]
  return rows.some((r) => r.name === column)
}

function ensureMigrations(database: SqliteDb): void {
  if (!columnExists(database, 'documents', 'thread_id')) {
    database.exec('ALTER TABLE documents ADD COLUMN thread_id TEXT')
  }
  if (!columnExists(database, 'chunks', 'thread_id')) {
    database.exec('ALTER TABLE chunks ADD COLUMN thread_id TEXT')
  }
  if (!columnExists(database, 'messages', 'citations_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN citations_json TEXT')
  }
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_documents_thread ON documents(thread_id)',
  )
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_chunks_thread ON chunks(thread_id)',
  )
}

function initSchema(database: SqliteDb): void {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(SCHEMA)
  ensureMigrations(database)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  return Number(value)
}

function normalizeBind(bind: unknown): unknown[] | undefined {
  if (bind === undefined) return undefined
  return Array.isArray(bind) ? bind : [bind]
}

/** Hold an exclusive lock for the worker lifetime so only one opener wins. */
async function acquireWebLock(): Promise<void> {
  if (releaseWebLock || typeof navigator === 'undefined' || !navigator.locks) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    navigator.locks
      .request(WEB_LOCK_NAME, { mode: 'exclusive' }, () => {
        return new Promise<void>((release) => {
          releaseWebLock = () => {
            releaseWebLock = null
            release()
          }
          if (!settled) {
            settled = true
            resolve()
          }
        })
      })
      .catch((err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })
  })
}

function releaseHeldWebLock(): void {
  if (releaseWebLock) {
    try {
      releaseWebLock()
    } catch {
      // ignore
    }
    releaseWebLock = null
  }
}

async function openPersistentDb(sqlite3: Sqlite3): Promise<{
  database: SqliteDb
  isPersistent: boolean
  backend: string
  error?: string
  pool?: PoolUtil
}> {
  const errors: string[] = []

  // Preferred: OPFS SAHPool — sync API, dedicated-worker friendly, survives reload.
  if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await acquireWebLock()
        const util = await sqlite3.installOpfsSAHPoolVfs({
          name: 'vaultai-opfs',
          initialCapacity: 8,
          forceReinitIfPreviouslyFailed: attempt > 1,
        })
        const database = new util.OpfsSAHPoolDb('/vaultai.db')
        return {
          database,
          isPersistent: true,
          backend: 'opfs-sahpool',
          pool: util,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`sahpool@${attempt}: ${message}`)
        console.warn(`[db.worker] OPFS SAHPool attempt ${attempt} failed`, err)
        releaseHeldWebLock()
        // Longer backoff: previous worker/tab may still hold Access Handles.
        await new Promise((r) => setTimeout(r, Math.min(2000, 250 * attempt)))
      }
    }
  } else {
    errors.push('sahpool: installOpfsSAHPoolVfs not available')
  }

  if ('opfs' in sqlite3) {
    try {
      return {
        database: new sqlite3.oo1.OpfsDb('/vaultai.db'),
        isPersistent: true,
        backend: 'opfs-async',
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`opfs-async: ${message}`)
      console.warn('[db.worker] async OPFS failed', err)
    }
  } else {
    errors.push('opfs-async: not available on sqlite3')
  }

  console.warn(
    '[db.worker] Persistent storage unavailable — chat history will not survive reload.',
    errors,
  )
  return {
    database: new sqlite3.oo1.DB('/vaultai.db', 'c'),
    isPersistent: false,
    backend: 'memory',
    error: errors.join(' | '),
  }
}

async function ensureReady(): Promise<void> {
  if (db) return
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const sqlite3 = await sqlite3InitModule()
        sqlite3Ref = sqlite3
        const opened = await openPersistentDb(sqlite3)
        db = opened.database
        poolUtil = opened.pool ?? null
        persistent = opened.isPersistent
        backend = opened.backend
        initError = opened.error
        initSchema(db)
        console.info(
          `[db.worker] ready (persistent=${persistent}, backend=${backend}, crossOriginIsolated=${self.crossOriginIsolated})`,
          initError ? `fallbackReason=${initError}` : '',
        )
      } catch (err) {
        initPromise = null
        releaseHeldWebLock()
        throw err
      }
    })()
  }
  await initPromise
}

async function shutdown(): Promise<void> {
  try {
    if (db) {
      try {
        db.close()
      } catch {
        // ignore
      }
      db = null
    }
    // pauseVfs releases SyncAccessHandles without deleting data.
    if (poolUtil && typeof poolUtil.pauseVfs === 'function') {
      try {
        poolUtil.pauseVfs()
      } catch {
        // ignore
      }
    }
    poolUtil = null
  } finally {
    releaseHeldWebLock()
    initPromise = null
    persistent = false
    backend = 'none'
    initError = undefined
  }
}

function requireDb(): SqliteDb {
  if (!db) throw new Error('Database not initialized')
  return db
}

function reply(msg: DbResponse): void {
  self.postMessage(msg)
}

/** Process one request at a time so last_insert_rowid stays correct. */
let chain: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task, task)
}

self.onmessage = (event: MessageEvent<DbRequest>): void => {
  const req = event.data
  enqueue(async () => {
    try {
      if (req.type === 'shutdown') {
        await shutdown()
        reply({ id: req.id, ok: true })
        return
      }

      if (req.type === 'init') {
        await ensureReady()
        reply({
          id: req.id,
          ok: true,
          persistent,
          backend,
          error: initError,
        })
        return
      }

      await ensureReady()
      const database = requireDb()

      if (req.type === 'exportBackup') {
        if (!sqlite3Ref?.capi?.sqlite3_js_db_export) {
          throw new Error('Database export is not available in this environment.')
        }
        try {
          database.exec('PRAGMA wal_checkpoint(FULL)')
        } catch {
          // Non-WAL backends may not support checkpoint.
        }
        const handle = database.pointer ?? database
        const bytes = sqlite3Ref.capi.sqlite3_js_db_export(
          handle,
        ) as Uint8Array
        reply({ id: req.id, ok: true, result: bytes })
        return
      }

      if (req.type === 'importBackup') {
        if (!poolUtil || typeof poolUtil.importDb !== 'function') {
          throw new Error(
            'Import requires OPFS persistence. Open Desk Ai in a single Chromium tab and try again.',
          )
        }
        try {
          database.close()
        } catch {
          // ignore
        }
        db = null
        await poolUtil.importDb('/vaultai.db', req.bytes)
        db = new poolUtil.OpfsSAHPoolDb('/vaultai.db')
        initSchema(db)
        reply({ id: req.id, ok: true })
        return
      }

      const bind = normalizeBind(req.bind)

      switch (req.type) {
        case 'exec': {
          if (bind !== undefined) {
            database.exec({ sql: req.sql, bind })
          } else {
            database.exec(req.sql)
          }
          reply({ id: req.id, ok: true })
          break
        }
        case 'execReturningLastId': {
          if (bind !== undefined) {
            database.exec({ sql: req.sql, bind })
          } else {
            database.exec(req.sql)
          }
          const lastId = asNumber(
            database.selectValue('SELECT last_insert_rowid()'),
          )
          reply({ id: req.id, ok: true, result: lastId })
          break
        }
        case 'selectObjects': {
          const rows =
            bind !== undefined
              ? database.selectObjects(req.sql, bind)
              : database.selectObjects(req.sql)
          reply({ id: req.id, ok: true, result: rows })
          break
        }
        case 'selectObject': {
          const row =
            bind !== undefined
              ? database.selectObject(req.sql, bind)
              : database.selectObject(req.sql)
          reply({ id: req.id, ok: true, result: row })
          break
        }
        case 'selectValue': {
          let value =
            bind !== undefined
              ? database.selectValue(req.sql, bind)
              : database.selectValue(req.sql)
          if (typeof value === 'bigint') value = Number(value)
          reply({ id: req.id, ok: true, result: value })
          break
        }
        default: {
          reply({
            id: (req as DbRequest).id,
            ok: false,
            error: 'Unknown request',
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[db.worker]', message, err)
      reply({ id: req.id, ok: false, error: message })
    }
  })
}
