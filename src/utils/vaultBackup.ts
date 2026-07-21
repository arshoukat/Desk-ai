import { getDb, ensureDbReady, disposeDbWorker } from '../storage/db'
import { invalidateVectorIndex } from '../storage/vectorIndex'

/** Download the full Desk Ai SQLite database as a local backup file. */
export async function downloadVaultBackup(): Promise<void> {
  const db = await getDb()
  const bytes = await db.exportBackup()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy], { type: 'application/x-sqlite3' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vaultai-backup-${new Date().toISOString().slice(0, 10)}.db`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Restore a previously exported `.db` backup. Reloads the page after import
 * so React state and the vector cache match the restored store.
 */
export async function restoreVaultBackup(file: File): Promise<void> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  if (buffer.byteLength < 512) {
    throw new Error('That file is too small to be a Desk Ai database backup.')
  }
  const db = await getDb()
  await db.importBackup(buffer)
  invalidateVectorIndex()
  await disposeDbWorker()
  await ensureDbReady()
  window.location.reload()
}
