// Whether a failed join-status poll is a blip (keep waiting) or a refusal (error
// page). Relative imports so bun test resolves them without the @mc alias.
import { ChannelGone, RelayError, Unreachable } from "@mc/client.ts"

/** A relay outage or overload: stay on waiting and poll again. */
export function isJoinBlip(err: unknown): boolean {
  if (err instanceof Unreachable) return true
  if (err instanceof ChannelGone) return false
  if (err instanceof RelayError) return err.status >= 500 || err.status === 429
  return err instanceof TypeError
}
