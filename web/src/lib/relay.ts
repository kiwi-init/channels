// The relay URL, in one place. It comes from the desktop shell's bridge
// (window.kiwi.relayUrl), else the `?relay=` entry param the shell injects,
// else location.origin (plain-browser development, where the dev server
// proxies /v1 to the relay). Nothing else in the renderer may use
// location.origin for relay traffic: call relayUrl() here instead.

function fromBridge(): string | null {
  try {
    const u = (window as unknown as { kiwi?: { relayUrl?: unknown } }).kiwi?.relayUrl
    return typeof u === "string" && /^https?:\/\//.test(u) ? u.replace(/\/+$/, "") : null
  } catch {
    return null
  }
}

function fromEntry(): string | null {
  try {
    const r = new URLSearchParams(window.location.search).get("relay")
    return r && /^https?:\/\//.test(r) ? r.replace(/\/+$/, "") : null
  } catch {
    return null
  }
}

/** The relay this renderer talks to. */
export function relayUrl(): string {
  return fromBridge() ?? fromEntry() ?? window.location.origin
}

/** Whether the renderer runs inside the desktop shell (a bridge is present). */
export function hasBridge(): boolean {
  try {
    return !!(window as unknown as { kiwi?: unknown }).kiwi
  } catch {
    return false
  }
}

/** The relay `kiwi` talks to when told nothing else. */
export const PUBLIC_RELAY = "https://channels.kiwiinit.com"
