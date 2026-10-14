// kiwi://join/<code>: the link an invite page (/join/<code>, site/) opens the desktop app with. The
// app's main process hands it over (window.kiwi.getDeepLink); this reads the channel out of it.
// Relative imports so bun test resolves it without the @mc alias.
import { decodeJoinCode } from "../../../src/crypto.ts"

/** The join code a kiwi://join/<code> link carries, or null when it carries none. */
export function joinCodeFromLink(url: string): string | null {
  const m = /^kiwi:\/\/join\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url.trim())
  if (!m) return null
  try {
    const code = decodeURIComponent(m[1]!).trim()
    decodeJoinCode(code)
    return code
  } catch {
    return null
  }
}
