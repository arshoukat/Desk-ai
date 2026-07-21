import { pipeline, env } from '@xenova/transformers'
import type { EmbedWorkerRequest, EmbedWorkerResponse } from '../types/messages'

type FeatureExtractionPipeline = (
  texts: string | string[],
  options?: {
    pooling?: 'mean' | 'cls' | 'none'
    normalize?: boolean
  },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>

let extractor: FeatureExtractionPipeline | null = null
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null
let configured = false

function configureEnv(): void {
  if (configured) return
  configured = true

  env.allowLocalModels = false
  env.useBrowserCache = true

  // Single-threaded WASM avoids SharedArrayBuffer / nested-worker issues.
  const wasm = env.backends.onnx.wasm as {
    numThreads?: number
    proxy?: boolean
    wasmPaths?: string
  }
  wasm.numThreads = 1
  wasm.proxy = false
  // Served from /public/wasm (copied by Vite plugin)
  wasm.wasmPaths = '/wasm/'
}

async function getExtractor(
  onProgress?: (progress: number, status: string) => void,
): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor

  if (!extractorPromise) {
    configureEnv()
    extractorPromise = (async () => {
      const pipe = (await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          progress_callback: (data: {
            status?: string
            progress?: number
            file?: string
          }) => {
            if (typeof data.progress === 'number') {
              onProgress?.(
                Math.min(100, Math.max(0, Math.round(data.progress))),
                data.status ?? data.file ?? 'Downloading embedding model…',
              )
            } else if (data.status) {
              onProgress?.(0, data.status)
            }
          },
        },
      )) as FeatureExtractionPipeline
      extractor = pipe
      return pipe
    })().catch((err) => {
      extractorPromise = null
      throw err
    })
  }

  return extractorPromise
}

function tensorToRows(
  output: { data: Float32Array | number[]; dims: number[] },
  count: number,
): number[][] {
  const data =
    output.data instanceof Float32Array
      ? Array.from(output.data)
      : Array.from(output.data)

  const hidden =
    output.dims.length >= 2
      ? output.dims[output.dims.length - 1]!
      : Math.floor(data.length / count)

  const rows: number[][] = []
  for (let i = 0; i < count; i++) {
    const start = i * hidden
    rows.push(data.slice(start, start + hidden))
  }
  return rows
}

self.onmessage = async (event: MessageEvent<EmbedWorkerRequest>) => {
  const msg = event.data
  const requestId = msg.requestId
  const respond = (payload: EmbedWorkerResponse) => {
    self.postMessage(payload)
  }

  try {
    if (msg.type === 'init') {
      await getExtractor((progress, status) => {
        respond({
          type: 'progress',
          requestId: msg.requestId,
          progress,
          status,
        })
      })
      respond({ type: 'ready', requestId: msg.requestId })
      return
    }

    if (msg.type === 'embed') {
      const pipe = await getExtractor((progress, status) => {
        respond({
          type: 'progress',
          requestId: msg.requestId,
          progress,
          status,
        })
      })

      const output = await pipe(msg.texts, {
        pooling: 'mean',
        normalize: true,
      })

      const embeddings = tensorToRows(output, msg.texts.length)
      respond({
        type: 'embed-result',
        requestId: msg.requestId,
        embeddings,
      })
      return
    }

    respond({
      type: 'error',
      requestId,
      message: `Unknown embedding worker message type: ${(msg as { type?: string }).type ?? 'undefined'}`,
    })
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Embedding model failed — check network for first download (then cached).'
    respond({
      type: 'error',
      requestId,
      message: `Embedding model failed — check network for first download (then cached). (${message})`,
    })
  }
}
