const EVENT = "kiwi:details"

let pending: string | null = null

export function requestDetails(code: string) {
  pending = code
  window.dispatchEvent(new CustomEvent(EVENT, { detail: code }))
}

export function takeDetailsRequest(code: string): boolean {
  if (pending !== code) return false
  pending = null
  return true
}

export function onDetailsRequest(code: string, open: () => void): () => void {
  const on = (e: Event) => {
    if (e instanceof CustomEvent && e.detail === code && takeDetailsRequest(code)) open()
  }
  window.addEventListener(EVENT, on)
  return () => window.removeEventListener(EVENT, on)
}
