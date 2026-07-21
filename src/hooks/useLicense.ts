import { useCallback, useEffect, useState } from 'react'
import {
  activateLicense,
  readActivation,
  type ActivationRecord,
  LicenseError,
} from '../utils/license'

export function useLicense() {
  const [isChecking, setIsChecking] = useState(true)
  const [isActivated, setIsActivated] = useState(false)
  const [activation, setActivation] = useState<ActivationRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isActivating, setIsActivating] = useState(false)

  useEffect(() => {
    const stored = readActivation()
    setActivation(stored)
    setIsActivated(stored !== null)
    setIsChecking(false)
  }, [])

  const activate = useCallback(async (licenseKey: string) => {
    setIsActivating(true)
    setError(null)
    try {
      const record = await activateLicense(licenseKey)
      setActivation(record)
      setIsActivated(true)
      return record
    } catch (err) {
      const message =
        err instanceof LicenseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Activation failed.'
      setError(message)
      throw err
    } finally {
      setIsActivating(false)
    }
  }, [])

  return {
    isChecking,
    isActivated,
    isActivating,
    activation,
    error,
    activate,
  }
}
