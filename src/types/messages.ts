export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface DocChunk {
  id: string
  docId: string
  filename: string
  text: string
  embedding: number[]
  createdAt: number
}

export interface DocumentSummary {
  docId: string
  filename: string
  chunkCount: number
  createdAt: number
}

export type EmbedWorkerRequest =
  | { type: 'embed'; requestId: string; texts: string[] }
  | { type: 'init'; requestId: string }

export type EmbedWorkerResponse =
  | {
      type: 'embed-result'
      requestId: string
      embeddings: number[][]
    }
  | {
      type: 'progress'
      requestId: string
      progress: number
      status: string
    }
  | {
      type: 'ready'
      requestId: string
    }
  | {
      type: 'error'
      requestId: string
      message: string
    }

export interface SearchResult {
  chunk: DocChunk
  score: number
}
