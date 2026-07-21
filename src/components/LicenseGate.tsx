import { useCallback, useEffect, useState } from 'react'
import { useLicense } from '../hooks/useLicense'
import { ActivationScreen } from './ActivationScreen'
import { Workspace } from './Workspace'
import {
  readFreeTierChoice,
  setFreeTierChoice,
} from '../utils/appTier'

/** Routes to free (ephemeral) or pro (licensed) workspace, or the welcome gate. */
export function LicenseGate() {
  const { isChecking, isActivated, isActivating, error, activate } =
    useLicense()
  const [freeChosen, setFreeChosen] = useState(false)

  useEffect(() => {
    setFreeChosen(readFreeTierChoice())
  }, [])

  const onContinueFree = useCallback(() => {
    setFreeTierChoice(true)
    setFreeChosen(true)
  }, [])

  const onActivate = useCallback(
    async (key: string) => {
      await activate(key)
      setFreeTierChoice(false)
      setFreeChosen(false)
    },
    [activate],
  )

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-muted">Checking license…</p>
      </div>
    )
  }

  if (isActivated) {
    return <Workspace tier="pro" />
  }

  if (freeChosen) {
    return <Workspace tier="free" />
  }

  return (
    <ActivationScreen
      error={error}
      isActivating={isActivating}
      onActivate={onActivate}
      onContinueFree={onContinueFree}
    />
  )
}
