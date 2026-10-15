// The relay URL, in one place. In the desktop app it is the shell's bridge
// (window.kiwi.relayUrl), and only that: the page's own URL is never trusted
// there, since the sign-in token goes wherever the relay is. In a browser it
// is a `?relay=` param, else location.origin (development, where the dev
// server proxies /v1 to the relay). Nothing else in the renderer may use
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
  if (hasBridge()) return fromBridge() ?? PUBLIC_RELAY
  return fromEntry() ?? window.location.origin
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
const PUBLIC_RELAY = "https://channels.kiwiinit.com"
