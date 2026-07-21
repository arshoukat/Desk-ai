import { openDB } from 'idb'
import type { VaultDb } from './db'
import { insertChunk, rebuildIndex } from './vectorIndex'
import type { DocChunk } from '../types/messages'

const LEGACY_DB = 'vaultai'
const LEGACY_STORE = 'chunks'

export async function migrateLegacyIdb(db: VaultDb): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  )

  const flag = await db.selectValue(
    "SELECT value FROM meta WHERE key = 'legacy_migrated'",
  )
  if (flag === '1') return

  let legacy: DocChunk[] = []
  try {
    const idb = await openDB(LEGACY_DB, 1)
    if (idb.objectStoreNames.contains(LEGACY_STORE)) {
      legacy = await idb.getAll(LEGACY_STORE)
      idb.close()
    }
  } catch {
    await db.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_migrated', '1')",
    )
    return
  }

  if (legacy.length === 0) {
    await db.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_migrated', '1')",
    )
    return
  }

  const byDoc = new Map<string, DocChunk[]>()
  for (const chunk of legacy) {
    const list = byDoc.get(chunk.docId) ?? []
    list.push(chunk)
    byDoc.set(chunk.docId, list)
  }

  for (const [docId, chunks] of byDoc) {
    const first = chunks[0]!
    await db.exec({
      sql: `INSERT OR IGNORE INTO documents (doc_id, filename, chunk_count, created_at)
            VALUES (?, ?, ?, ?)`,
      bind: [docId, first.filename, chunks.length, first.createdAt],
    })
    for (const chunk of chunks) {
      try {
        await insertChunk(
          chunk.id,
          chunk.docId,
          null,
          chunk.filename,
          chunk.text,
          chunk.embedding,
          chunk.createdAt,
        )
      } catch (err) {
        // Resume after a partial prior run (UNIQUE on chunk id).
        const message = err instanceof Error ? err.message : String(err)
        if (!/UNIQUE|constraint/i.test(message)) throw err
      }
    }
  }

  try {
    const idb = await openDB(LEGACY_DB, 1)
    if (idb.objectStoreNames.contains(LEGACY_STORE)) {
      const tx = idb.transaction(LEGACY_STORE, 'readwrite')
      await tx.store.clear()
      await tx.done
    }
    idb.close()
  } catch {
    // non-fatal
  }

  await rebuildIndex()
  await db.exec(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_migrated', '1')",
  )
}
