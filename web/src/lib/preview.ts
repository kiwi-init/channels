import { ignored, type Message, type Trust } from "@kiwi/core/protocol.ts"

/** The last thing said that this viewer actually sees: not events, not a note only to its sender, not ignored. */
export function lastPreview(messages: readonly Message[], trust: (seq: number) => Trust | undefined): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.kind === "event") continue
    if (ignored(trust(m.seq))) continue
    if (m.to?.length && m.to.every((n) => n === m.from)) continue
    return m
  }
}
