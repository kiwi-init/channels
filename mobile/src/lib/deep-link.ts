import { decodeJoinCode } from "@mc/crypto.ts"
import { joinCodeFromLink } from "@web/lib/deep-link"

export { joinCodeFromLink }

const INVITE_PAGE = /^https:\/\/[^/\s]+\/join\/([^/?#\s]+)\/?(?:[?#].*)?$/

export function joinCodeFromInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const fromLink = joinCodeFromLink(text)
  if (fromLink) return fromLink
  const page = INVITE_PAGE.exec(text)?.[1]
  const candidate = page ?? (/\s/.test(text) ? null : text)
  if (!candidate) return null
  try {
    const code = decodeURIComponent(candidate).trim()
    decodeJoinCode(code)
    return code
  } catch {
    return null
  }
}
