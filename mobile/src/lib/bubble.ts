import type { Message } from "@mc/protocol.ts"

export { excerpt } from "@web/lib/format"

export interface Said {
  text: string
  alert?: boolean
  decide?: boolean
}

export function phrase(m: Message, me: string, nameOf: (name: string) => string, repliedTo: ReadonlySet<string>): Said | null {
  const named = (target: string) => m.body.includes(`@${target}`) || repliedTo.has(target)
  const targets = m.kind === "ask" || m.kind === "blocking" ? (m.to ?? []) : (m.to ?? []).filter((target) => !named(target))
  const to = targets.map((target) => (target === "*" ? "everyone" : target === me ? "you" : nameOf(target)))
  const list = to.length > 1 ? `${to.slice(0, -1).join(", ")} and ${to[to.length - 1]}` : to[0]
  if (m.esc && m.handoff) return { text: to.includes("you") ? "Browser for you" : list ? `Browser for ${list}` : "Browser for people", decide: true }
  if (m.esc) return { text: to.includes("you") ? "Decision for you" : list ? `Decision for ${list}` : "Decision for people", decide: true }
  switch (m.kind) {
    case "ask":
      return { text: list ? `asks ${list}` : "asks everyone" }
    case "blocking":
      return { text: list ? `is blocked, needs ${list}` : "is blocked", alert: true }
    case "done":
      return { text: "finished" }
    case "status":
      return { text: "update" }
    case "ack":
      return { text: "acknowledged" }
    default:
      return list ? { text: `to ${list}` } : null
  }
}

export function isImageOnly(m: Pick<Message, "body" | "imgs">): boolean {
  return !!m.imgs?.length && m.body === m.imgs.map((img) => img.name).join(", ")
}

export function forgedNote(m: Pick<Message, "from" | "pk">, trust: "forged" | "refused"): string {
  const signer = m.pk ? `Signed by key ${m.pk.slice(0, 8)}.` : "Unsigned."
  return `${trust === "refused" ? "Not allowed by your settings, so every view leaves it out." : `Forged: not signed by ${m.from}’s key, so every view leaves it out.`} ${signer}`
}
