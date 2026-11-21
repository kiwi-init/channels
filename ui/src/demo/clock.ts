const KEY = "kiwi:demo-now"

function sessionNow(): number {
  try {
    const was = Number(sessionStorage.getItem(KEY))
    if (Number.isSafeInteger(was) && was > 0) return was
    const now = Date.now()
    sessionStorage.setItem(KEY, String(now))
    return now
  } catch {
    // Storage can be off: each load starts its own clock, as a first open does.
    return Date.now()
  }
}

export const DEMO_NOW = sessionNow()
