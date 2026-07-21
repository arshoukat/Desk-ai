/** App access tier: free (ephemeral) vs pro (licensed + persistent). */

export type AppTier = 'free' | 'pro'

const FREE_FLAG_KEY = 'deskai-use-free'

/** Remember that the user chose the free tier (messages still never persist). */
export function readFreeTierChoice(): boolean {
  try {
    return localStorage.getItem(FREE_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export function setFreeTierChoice(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(FREE_FLAG_KEY, '1')
    else localStorage.removeItem(FREE_FLAG_KEY)
  } catch {
    /* ignore */
  }
}
