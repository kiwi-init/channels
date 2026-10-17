import { ignored, type Message, type Trust } from "@mc/protocol.ts"

/**
 * The last thing said that this viewer actually sees: not events, not a note
 * only to its sender, not ignored, and not kept from people in coordinator-strict.
 */
export function lastPreview(messages: readonly Message[], reaches: (m: Message) => boolean, trust: (seq: number) => Trust | undefined): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.kind === "event") continue
    if (ignored(trust(m.seq))) continue
    if (m.to?.length && m.to.every((n) => n === m.from)) continue
    if (!reaches(m)) continue
    return m
  }
}
