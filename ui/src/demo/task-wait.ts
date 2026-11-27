import { omit } from "@kiwi/core/omit.ts"
import type { Channel } from "~/model"
import { wrote } from "~/words"

export function withTaskWait(channel: Channel): Channel {
  const until = Date.now() + 6 * 60 * 60_000
  return {
    ...channel,
    tasks: channel.tasks.map((t) => (t.id === 17 ? { ...t, mover: { kind: "wait", reason: wrote("until the relay's load test on staging stays under 65% on 2 reads"), until }, quiet: undefined } : t)),
  }
}

export function withHeldStep(channel: Channel): Channel {
  return {
    ...channel,
    tasks: channel.tasks.map((t) =>
      t.id === 13 && t.steps
        ? {
            ...t,
            mover: { kind: "member", name: "atlas", move: "lift" },
            steps: t.steps.map((s) => (s.id === "s2" ? { ...omit(s, "yours"), held: { by: "atlas", reason: wrote("until the release notes are in") } } : s)),
          }
        : t
    ),
  }
}
