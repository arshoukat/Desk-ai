import type { DbRequest, DbRequestPayload, DbResponse } from '../workers/db.worker'

/**
 * Main-thread proxy to the SQLite Web Worker.
 * Ensures a single worker instance and releases OPFS Access Handles on HMR /
 * page unload so the next load can open SAHPool successfully.
 */

export type VaultDb = {
  exec: (sql: string | { sql: string; bind?: unknown }) => Promise<void>
  execReturningLastId: (opts: {
    sql: string
    bind?: unknown
  }) => Promise<number>
  selectObjects: <T = Record<string, unknown>>(
    sql: string,
    bind?: unknown,
  ) => Promise<T[]>
  selectObject: <T = Record<string, unknown>>(
    sql: string,
    bind?: unknown,
  ) => Promise<T | undefined>
  selectValue: (sql: string, bind?: unknown) => Promise<unknown>
  exportBackup: () => Promise<Uint8Array>
  importBackup: (bytes: Uint8Array) => Promise<void>
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  isInit?: boolean
}

type DbStatus = {
  persistent: boolean
  backend?: string
  error?: string
}

let worker: Worker | null = null
let nextId = 1
let readyPromise: Promise<DbStatus> | null = null
let migratePromise: Promise<void> | null = null
let migrated = false
let disposing = false
const pending = new Map<number, Pending>()

function rejectAllPending(reason: Error): void {
  for (const entry of pending.values()) {
    entry.reject(reason)
  }
  pending.clear()
}

function resetWorkerState(reason: Error): void {
  rejectAllPending(reason)
  if (worker) {
    try {
      worker.terminate()
    } catch {
      // ignore
    }
  }
  worker = null
  readyPromise = null
  migratePromise = null
  migrated = false
}

function attachWorkerHandlers(w: Worker): void {
  w.onmessage = (event: MessageEvent<DbResponse>) => {
    const msg = event.data
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (!msg.ok) {
      entry.reject(new Error(msg.error))
      return
    }
    if (entry.isInit) {
      entry.resolve({
        persistent: Boolean(msg.persistent),
        backend: msg.backend,
        error: msg.error,
      })
    } else {
      entry.resolve(msg.result)
    }
  }
  w.onerror = (event) => {
    console.error('[db] worker error', event.message)
    resetWorkerState(new Error(event.message || 'Database worker crashed'))
  }
}

function getWorker(): Worker {
  if (disposing) {
    throw new Error('Database worker is shutting down')
  }
  if (!worker) {
    worker = new Worker(new URL('../workers/db.worker.ts', import.meta.url), {
      type: 'module',
    })
    attachWorkerHandlers(worker)
  }
  return worker
}

function callWorker<T = unknown>(
  payload: DbRequestPayload,
  options?: { isInit?: boolean },
): Promise<T> {
  const id = nextId++
  const w = getWorker()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      isInit: options?.isInit,
    })
    w.postMessage({ ...payload, id } as DbRequest)
  })
}

/**
 * Gracefully close the DB and release OPFS Access Handles, then terminate.
 */
export async function disposeDbWorker(): Promise<void> {
  if (!worker) {
    readyPromise = null
    migrated = false
    return
  }
  disposing = true
  const w = worker
  try {
    const id = nextId++
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 1500)
      const onMessage = (event: MessageEvent<DbResponse>) => {
        if (event.data.id !== id) return
        clearTimeout(timeout)
        w.removeEventListener('message', onMessage)
        resolve()
      }
      w.addEventListener('message', onMessage)
      try {
        w.postMessage({ id, type: 'shutdown' } satisfies DbRequest)
      } catch {
        clearTimeout(timeout)
        w.removeEventListener('message', onMessage)
        resolve()
      }
    })
  } finally {
    rejectAllPending(new Error('Database worker disposed'))
    try {
      w.terminate()
    } catch {
      // ignore
    }
    worker = null
    readyPromise = null
    migratePromise = null
    migrated = false
    disposing = false
  }
}

/**
 * Ensures the worker DB is open. Returns whether OPFS persistence is active.
 */
export async function ensureDbReady(): Promise<DbStatus> {
  if (!readyPromise) {
    readyPromise = callWorker<DbStatus>({ type: 'init' }, { isInit: true })
      .then((info) => {
        if (!info.persistent) {
          console.warn(
            '[db] Running without OPFS persistence — chats will not survive reload.',
            info.backend,
          )
        } else if (import.meta.env.DEV) {
          console.info('[db] Persistent OPFS storage ready', info.backend)
        }
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          ;(window as unknown as { __VAULT_DB__?: DbStatus }).__VAULT_DB__ =
            info
        }
        return info
      })
      .catch((err) => {
        readyPromise = null
        throw err
      })
  }
  return readyPromise
}

const proxy: VaultDb = {
  async exec(sqlOrOpts) {
    await ensureDbReady()
    if (typeof sqlOrOpts === 'string') {
      await callWorker({ type: 'exec', sql: sqlOrOpts })
    } else {
      await callWorker({
        type: 'exec',
        sql: sqlOrOpts.sql,
        bind: sqlOrOpts.bind,
      })
    }
  },

  async execReturningLastId(opts) {
    await ensureDbReady()
    return callWorker<number>({
      type: 'execReturningLastId',
      sql: opts.sql,
      bind: opts.bind,
    })
  },

  async selectObjects<T = Record<string, unknown>>(sql: string, bind?: unknown) {
    await ensureDbReady()
    return callWorker<T[]>({ type: 'selectObjects', sql, bind })
  },

  async selectObject<T = Record<string, unknown>>(sql: string, bind?: unknown) {
    await ensureDbReady()
    return callWorker<T | undefined>({ type: 'selectObject', sql, bind })
  },

  async selectValue(sql: string, bind?: unknown) {
    await ensureDbReady()
    return callWorker({ type: 'selectValue', sql, bind })
  },

  async exportBackup() {
    await ensureDbReady()
    const bytes = await callWorker<Uint8Array>({ type: 'exportBackup' })
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer)
  },

  async importBackup(bytes: Uint8Array) {
    await ensureDbReady()
    await callWorker({ type: 'importBackup', bytes })
  },
}

export async function getDb(): Promise<VaultDb> {
  await ensureDbReady()
  if (!migrated) {
    if (!migratePromise) {
      migratePromise = (async () => {
        const { migrateLegacyIdb } = await import('./migrate')
        await migrateLegacyIdb(proxy)
        migrated = true
      })().finally(() => {
        migratePromise = null
      })
    }
    await migratePromise
  }
  return proxy
}

export const EMBEDDING_DIM = 384

// Release OPFS handles before the tab goes away or Vite HMR replaces this module.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void disposeDbWorker()
  })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void disposeDbWorker()
  })
  import.meta.hot.accept()
}
