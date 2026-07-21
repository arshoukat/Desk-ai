/**
 * Desk Ai local engine configuration.
 *
 * Single-model architecture: Qwen3-1.7B runs entirely in-browser via WebGPU
 * (@mlc-ai/web-llm). Weights are cached by WebLLM (Cache API / IndexedDB) so the
 * ~1.2 GB download happens exactly once, then loads instantly offline.
 */
export const CHAT_MODEL = 'Qwen3-1.7B-q4f16_1-MLC'

export const CHAT_MODEL_LABEL = 'Qwen3 1.7B'

/** Approximate on-disk download size, shown in onboarding UI. */
export const CHAT_MODEL_SIZE_LABEL = '~1.2 GB'
