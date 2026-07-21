/** Dodo Payments license activation + local persistence for Desk Ai. */

export interface ActivationRecord {
  licenseKey: string
  instanceId: string
  deviceName: string
  activatedAt: string
  /** Simple integrity tag — deters casual localStorage edits. */
  tag: string
}

const STORAGE_KEY = 'deskai-license-activation'

const DODO_API_BASE =
  import.meta.env.VITE_DODO_API_BASE ?? 'https://test.dodopayments.com'

export const MARKETING_URL =
  import.meta.env.VITE_MARKETING_URL ?? 'https://desk-ai.com'

/** Client-side activate attempt limiter (Dodo also rate-limits server-side). */
const ACTIVATE_WINDOW_MS = 60_000
const ACTIVATE_MAX_ATTEMPTS = 5
let activateAttempts: number[] = []

export class LicenseError extends Error {
  code: 'not_found' | 'inactive' | 'limit' | 'network' | 'invalid' | 'rate_limited'

  constructor(
    message: string,
    code:
      | 'not_found'
      | 'inactive'
      | 'limit'
      | 'network'
      | 'invalid'
      | 'rate_limited',
  ) {
    super(message)
    this.name = 'LicenseError'
    this.code = code
  }
}

function integrityTag(record: Omit<ActivationRecord, 'tag'>): string {
  const payload = `${record.licenseKey}|${record.instanceId}|${record.activatedAt}`
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i)
    hash |= 0
  }
  return `da${Math.abs(hash).toString(36)}`
}

function assertActivateRateLimit(): void {
  const now = Date.now()
  activateAttempts = activateAttempts.filter((t) => now - t < ACTIVATE_WINDOW_MS)
  if (activateAttempts.length >= ACTIVATE_MAX_ATTEMPTS) {
    throw new LicenseError(
      'Too many activation attempts. Wait a minute and try again.',
      'rate_limited',
    )
  }
  activateAttempts.push(now)
}

/** Never log or display the full license key. */
export function redactLicenseKey(key: string): string {
  const t = key.trim()
  if (t.length <= 8) return '[REDACTED]'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

export function getDeviceName(): string {
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  if (/Linux/i.test(ua)) return 'Linux PC'
  if (/Android/i.test(ua)) return 'Android device'
  if (/iPhone|iPad/i.test(ua)) return 'Apple mobile'
  return 'Browser'
}

export function readActivation(): ActivationRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActivationRecord
    if (
      !parsed.licenseKey ||
      !parsed.instanceId ||
      !parsed.activatedAt ||
      !parsed.tag
    ) {
      return null
    }
    const { tag, ...rest } = parsed
    if (tag !== integrityTag(rest)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeActivation(
  record: Omit<ActivationRecord, 'tag'>,
): ActivationRecord {
  const full: ActivationRecord = { ...record, tag: integrityTag(record) }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full))
  return full
}

export function clearActivation(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Wipe license activation + chat thread pointer from localStorage.
 * Document/chat SQLite data is cleared via Clear chat / Delete chat / clear site data.
 */
export function clearLocalLicenseAndPrefs(): void {
  clearActivation()
  try {
    localStorage.removeItem('vaultai_active_thread')
    localStorage.removeItem('deskai-use-free')
  } catch {
    /* ignore */
  }
}

interface ActivateResponse {
  id: string
}

interface ValidateResponse {
  valid: boolean
}

function mapStatusToError(status: number): LicenseError {
  switch (status) {
    case 404:
      return new LicenseError(
        'License key not found. Check the key from your purchase email.',
        'not_found',
      )
    case 403:
      return new LicenseError(
        'This license key is inactive or revoked.',
        'inactive',
      )
    case 422:
      return new LicenseError(
        'Activation limit reached for this key. Deactivate another device in your account, or contact support.',
        'limit',
      )
    default:
      return new LicenseError(
        'Could not verify license. Check your internet connection and try again.',
        'network',
      )
  }
}

export async function activateLicense(
  licenseKey: string,
  deviceName = getDeviceName(),
): Promise<ActivationRecord> {
  const trimmed = licenseKey.trim()
  if (!trimmed) {
    throw new LicenseError('Please enter a license key.', 'invalid')
  }

  assertActivateRateLimit()

  if (
    import.meta.env.PROD &&
    DODO_API_BASE.includes('test.dodopayments.com')
  ) {
    console.warn(
      '[license] Production build is still pointing at Dodo TEST API. Set VITE_DODO_API_BASE=https://live.dodopayments.com',
    )
  }

  let res: Response
  try {
    res = await fetch(`${DODO_API_BASE}/licenses/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: trimmed, name: deviceName }),
    })
  } catch {
    throw new LicenseError(
      'Network error while activating. Connect to the internet and try again.',
      'network',
    )
  }

  if (!res.ok) {
    throw mapStatusToError(res.status)
  }

  const data = (await res.json()) as ActivateResponse
  if (!data.id) {
    throw new LicenseError('Unexpected response from license server.', 'network')
  }

  return writeActivation({
    licenseKey: trimmed,
    instanceId: data.id,
    deviceName,
    activatedAt: new Date().toISOString(),
  })
}

export async function validateLicense(licenseKey: string): Promise<boolean> {
  const trimmed = licenseKey.trim()
  if (!trimmed) return false

  let res: Response
  try {
    res = await fetch(`${DODO_API_BASE}/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: trimmed }),
    })
  } catch {
    return false
  }

  if (!res.ok) return false
  const data = (await res.json()) as ValidateResponse
  return data.valid === true
}
