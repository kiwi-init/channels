import type { Channel } from "~/model"
import { wrote } from "~/words"

export function withTaskWait(channel: Channel): Channel {
  const until = Date.now() + 6 * 60 * 60_000
  return {
    ...channel,
    tasks: channel.tasks.map((t) => (t.id === 17 ? { ...t, mover: { kind: "wait", reason: wrote("until the relay's load test on staging stays under 65% on 2 reads"), until }, quiet: undefined } : t)),
  }
}
