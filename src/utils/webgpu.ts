export class WebGPUError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebGPUError'
  }
}

/** Throws if WebGPU is unavailable so callers can surface a clear UX message. */
export function assertWebGPU(): void {
  if (typeof navigator === 'undefined') {
    throw new WebGPUError(
      'WebGPU unavailable — this environment has no browser navigator.',
    )
  }

  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu
  if (!gpu) {
    throw new WebGPUError(
      'WebGPU is disabled or unsupported — enable it in chrome://flags or use Chrome/Edge 113+.',
    )
  }
}

export function isWebGPUAvailable(): boolean {
  try {
    assertWebGPU()
    return true
  } catch {
    return false
  }
}
