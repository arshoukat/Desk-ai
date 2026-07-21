import { useCallback, useRef, useState } from 'react'
import {
  WebWorkerMLCEngine,
  hasModelInCache,
  type ChatCompletionMessageParam,
  type InitProgressReport,
} from '@mlc-ai/web-llm'
import { assertWebGPU, isWebGPUAvailable, WebGPUError } from '../utils/webgpu'
import { CHAT_MODEL } from '../utils/models'
import type { ChatMessage } from '../types/messages'

export interface GenerateOptions {
  systemPrompt?: string
  temperature?: number
  /** Qwen3 chain-of-thought. Defaults per method (on for `generate`, off for RAG). */
  enableThinking?: boolean
}

/**
 * Module-level singletons. The worker + engine are created exactly once and are
 * intentionally NOT torn down on component unmount. This survives React 19
 * StrictMode's mount → unmount → mount cycle, which would otherwise terminate
 * the worker mid-`reload()` and leave the WebGPU device orphaned (symptom: the
 * download hangs silently at 0% and never fetches a single shard).
 */
let sharedWorker: Worker | null = null
let sharedEngine: WebWorkerMLCEngine | null = null
let loadPromise: Promise<void> | null = null
let engineLoaded = false

function getEngine(): WebWorkerMLCEngine {
  if (!sharedEngine) {
    sharedWorker = new Worker(
      new URL('../workers/ai.worker.ts', import.meta.url),
      { type: 'module' },
    )
    sharedEngine = new WebWorkerMLCEngine(sharedWorker)
  }
  return sharedEngine
}

export interface UseLocalAIReturn {
  /** True once the model is fully loaded into GPU memory and ready to use. */
  isLoaded: boolean
  /** True only during the initial (uncached) weight download. */
  isDownloading: boolean
  /** 0–100 progress for download + GPU load. */
  downloadProgress: number
  /** Human-readable status, e.g. "Fetching param cache…". */
  downloadStatusText: string
  /** True during active token generation. */
  isGenerating: boolean
  /** Accumulating streamed text for the in-flight generation. */
  streamedResponse: string
  /** Seconds elapsed during the current load (proves the download is alive). */
  loadElapsedSec: number
  error: string | null
  /** Whether the browser exposes WebGPU at all. */
  isWebGPUSupported: boolean
  modelId: string | null
  /** Download (once) + load the model into VRAM. Safe to call repeatedly. */
  loadModel: () => Promise<void>
  /** Single-prompt generation. Thinking on by default. */
  generate: (prompt: string, options?: GenerateOptions) => Promise<string>
  /** Full message-array generation (RAG Workspace). Thinking on by default. */
  generateResponse: (
    messages: ChatMessage[],
    options?: GenerateOptions,
  ) => Promise<string>
  /** Interrupt the in-flight stream; returns the partial text already generated. */
  stopGeneration: () => void
  clearError: () => void
}

function toEngineMessages(
  messages: ChatMessage[],
): ChatCompletionMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  })) as ChatCompletionMessageParam[]
}

export function useLocalAI(): UseLocalAIReturn {
  const isLoadedRef = useRef(engineLoaded)

  const [isLoaded, setIsLoaded] = useState(engineLoaded)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(engineLoaded ? 100 : 0)
  const [downloadStatusText, setDownloadStatusText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedResponse, setStreamedResponse] = useState('')
  const [loadElapsedSec, setLoadElapsedSec] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [modelId, setModelId] = useState<string | null>(
    engineLoaded ? CHAT_MODEL : null,
  )
  const [isWebGPUSupported] = useState<boolean>(() => isWebGPUAvailable())

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const loadModel = useCallback(async (): Promise<void> => {
    if (engineLoaded) {
      setIsLoaded(true)
      setDownloadProgress(100)
      isLoadedRef.current = true
      return
    }

    // A load is already in flight (e.g. StrictMode remount): attach progress
    // to it instead of starting a second, conflicting download.
    if (loadPromise) {
      const engine = getEngine()
      engine.setInitProgressCallback((report: InitProgressReport) => {
        setDownloadProgress(
          Math.min(100, Math.max(0, Math.round(report.progress * 100))),
        )
        if (report.text) setDownloadStatusText(report.text)
      })
      try {
        await loadPromise
      } catch {
        // Primary loader already recorded the error; sync local state below.
      }
      if (engineLoaded) {
        setIsLoaded(true)
        setDownloadProgress(100)
        setDownloadStatusText('Ready')
        setIsDownloading(false)
        setModelId(CHAT_MODEL)
        isLoadedRef.current = true
      }
      return
    }

    setLoadElapsedSec(0)
    const startedAt = Date.now()
    const elapsedTimer = setInterval(() => {
      setLoadElapsedSec(Math.round((Date.now() - startedAt) / 1000))
    }, 1000)

    const run = (async () => {
      setError(null)
      setDownloadProgress(0)

      try {
        assertWebGPU()
        const engine = getEngine()

        let cached = false
        try {
          cached = await hasModelInCache(CHAT_MODEL)
        } catch {
          cached = false
        }

        setIsDownloading(!cached)
        setDownloadStatusText(
          cached ? 'Loading model into GPU memory…' : 'Preparing download…',
        )

        engine.setInitProgressCallback((report: InitProgressReport) => {
          const pct = Math.min(
            100,
            Math.max(0, Math.round(report.progress * 100)),
          )
          setDownloadProgress(pct)
          if (report.text) setDownloadStatusText(report.text)
          // Once weights are loading into VRAM, it's no longer a network fetch.
          if (/loading model from cache|shader|gpu|vram|finish loading/i.test(
            report.text,
          )) {
            setIsDownloading(false)
          }
        })

        await engine.reload(CHAT_MODEL)

        engineLoaded = true
        setModelId(CHAT_MODEL)
        setDownloadProgress(100)
        setDownloadStatusText('Ready')
        setIsDownloading(false)
        setIsLoaded(true)
        isLoadedRef.current = true
      } catch (err) {
        setIsDownloading(false)
        setIsLoaded(false)
        isLoadedRef.current = false
        if (err instanceof WebGPUError) {
          setError(err.message)
        } else {
          const message =
            err instanceof Error ? err.message : 'Unknown model load failure'
          setError(
            `Model failed to load — retry or free GPU memory. (${message})`,
          )
        }
        throw err
      } finally {
        clearInterval(elapsedTimer)
        loadPromise = null
      }
    })()

    loadPromise = run
    return run.catch(() => undefined)
  }, [])

  const generatingRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const partialRef = useRef('')

  const stopGeneration = useCallback(() => {
    if (!generatingRef.current) return
    stopRequestedRef.current = true
    try {
      getEngine().interruptGenerate()
    } catch (err) {
      console.warn('[useLocalAI] interruptGenerate failed', err)
    }
  }, [])

  const runStream = useCallback(
    async (
      messages: ChatCompletionMessageParam[],
      enableThinking: boolean,
      temperature: number,
    ): Promise<string> => {
      if (!isLoadedRef.current) {
        const msg = 'Model is not ready yet. Wait for the download to finish.'
        setError(msg)
        throw new Error(msg)
      }
      if (generatingRef.current) {
        throw new Error('A response is already being generated.')
      }
      const engine = getEngine()

      setError(null)
      generatingRef.current = true
      stopRequestedRef.current = false
      partialRef.current = ''
      setIsGenerating(true)
      setStreamedResponse('')

      try {
        const stream = await engine.chat.completions.create({
          messages,
          stream: true,
          stream_options: { include_usage: false },
          temperature,
          extra_body: { enable_thinking: enableThinking },
        })

        let full = ''
        for await (const chunk of stream) {
          if (stopRequestedRef.current) break
          const delta = chunk.choices[0]?.delta?.content ?? ''
          if (delta) {
            full += delta
            partialRef.current = full
            setStreamedResponse(full)
          }
        }
        return full
      } catch (err) {
        if (stopRequestedRef.current && partialRef.current) {
          return partialRef.current
        }
        const message =
          err instanceof Error ? err.message : 'Generation failed unexpectedly'
        setError(message)
        throw err
      } finally {
        generatingRef.current = false
        stopRequestedRef.current = false
        setIsGenerating(false)
      }
    },
    [],
  )

  const generate = useCallback(
    (prompt: string, options?: GenerateOptions): Promise<string> => {
      const messages: ChatCompletionMessageParam[] = []
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt })
      }
      messages.push({ role: 'user', content: prompt })
      return runStream(
        messages,
        options?.enableThinking ?? true,
        options?.temperature ?? 0.7,
      )
    },
    [runStream],
  )

  const generateResponse = useCallback(
    (messages: ChatMessage[], options?: GenerateOptions): Promise<string> => {
      return runStream(
        toEngineMessages(messages),
        options?.enableThinking ?? true,
        options?.temperature ?? 0.6,
      )
    },
    [runStream],
  )

  return {
    isLoaded,
    isDownloading,
    downloadProgress,
    downloadStatusText,
    isGenerating,
    streamedResponse,
    loadElapsedSec,
    error,
    isWebGPUSupported,
    modelId,
    loadModel,
    generate,
    generateResponse,
    stopGeneration,
    clearError,
  }
}

export { CHAT_MODEL }
