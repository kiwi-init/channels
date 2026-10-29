import type { Message as Wire } from "@kiwi/core/protocol.ts"
import type { Said } from "~/model"

export function phraseOf(m: Wire, me: string, nameOf: (name: string) => string, repliedTo: ReadonlySet<string>): Said | undefined {
  if (m.from === me && !m.esc) return undefined
  const named = (t: string) => m.body.includes(`@${t}`) || repliedTo.has(t)
  const targets = m.kind === "ask" || m.kind === "blocking" ? (m.to ?? []) : (m.to ?? []).filter((t) => !named(t))
  const to = targets.map((t) => (t === "*" ? "everyone" : t === me ? "you" : nameOf(t)))
  const list = to.length > 1 ? `${to.slice(0, -1).join(", ")} and ${to[to.length - 1]}` : to[0]
  const forYou = to.includes("you")
  if (m.esc && m.handoff) return { text: forYou ? "Browser for you" : list ? `Browser for ${list}` : "Browser for people", tone: "decide" }
  if (m.esc && m.step) return { text: forYou ? "A step for you" : list ? `A step for ${list}` : "A step for people", tone: "decide" }
  if (m.esc) return { text: forYou ? "Decision for you" : list ? `Decision for ${list}` : "Decision for people", tone: "decide" }
  switch (m.kind) {
    case "ask":
      return { text: list ? `asks ${list}` : "asks everyone", tone: "ask" }
    case "blocking":
      return { text: list ? `is blocked, needs ${list}` : "is blocked", tone: "alert" }
    case "done":
      return { text: "finished", tone: "quiet" }
    case "status":
      return { text: "update", tone: "quiet" }
    case "ack":
      return { text: "acknowledged", tone: "quiet" }
    default:
      return list ? { text: `to ${list}`, tone: "quiet" } : undefined
  }
}
