/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

/**
 * Dedicated Web Worker for all WebLLM work: model download, WebGPU
 * orchestration, and prompt evaluation. Keeping this off the main thread is
 * what guarantees the UI stays at 60fps during generation.
 *
 * The handler is created lazily on the first message so the worker module
 * evaluates cleanly under Vite's ESM worker bundling (avoids eager
 * side-effects during dynamic module resolution).
 */
let handler: WebWorkerMLCEngineHandler | null = null

self.onmessage = (msg: MessageEvent): void => {
  if (!handler) {
    handler = new WebWorkerMLCEngineHandler()
  }
  handler.onmessage(msg)
}
