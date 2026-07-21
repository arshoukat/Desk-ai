export { getDb, ensureDbReady, disposeDbWorker, EMBEDDING_DIM } from './db'
export * from './chatStore'
export {
  searchVectors,
  fetchChunksByNumericIds,
  fetchChunksByDocId,
  insertChunk,
  updateChunkEmbedding,
  removeDocFromIndex,
  rebuildIndex,
  invalidateVectorIndex,
} from './vectorIndex'
export { migrateLegacyIdb } from './migrate'
