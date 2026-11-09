import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { t } from "~/i18n/i18n"
import type { Said } from "~/model"

export function phraseOf(m: Wire, me: string, nameOf: (name: string) => string, repliedTo: ReadonlySet<string>): Said | undefined {
  if (m.from === me && !m.esc) return undefined
  const named = (n: string) => m.body.includes(`@${n}`) || repliedTo.has(n)
  const targets = m.kind === "ask" || m.kind === "blocking" ? (m.to ?? []) : (m.to ?? []).filter((n) => !named(n))
  const you = t("live.said.you")
  const to = targets.map((n) => (n === "*" ? t("live.said.everyone") : n === me ? you : nameOf(n)))
  const list = to.length > 1 ? t("live.said.and", { rest: to.slice(0, -1).join(", "), last: to[to.length - 1]! }) : to[0]
  const forYou = to.includes(you)
  if (m.esc && m.handoff) return { text: forYou ? t("live.said.browser.you") : list ? t("live.said.browser.to", { list }) : t("live.said.browser.people"), tone: "decide" }
  if (m.esc && m.step) return { text: forYou ? t("live.said.step.you") : list ? t("live.said.step.to", { list }) : t("live.said.step.people"), tone: "decide" }
  if (m.esc) return { text: forYou ? t("live.said.decision.you") : list ? t("live.said.decision.to", { list }) : t("live.said.decision.people"), tone: "decide" }
  switch (m.kind) {
    case "ask":
      return { text: list ? t("live.said.asks.to", { list }) : t("live.said.asks.everyone"), tone: "ask" }
    case "blocking":
      return { text: list ? t("live.said.blocked.needs", { list }) : t("live.said.blocked"), tone: "alert" }
    case "done":
      return { text: t("live.said.finished"), tone: "quiet" }
    case "status":
      return { text: t("live.said.update"), tone: "quiet" }
    case "ack":
      return { text: t("live.said.acknowledged"), tone: "quiet" }
    default:
      return list ? { text: t("live.said.to", { list }), tone: "quiet" } : undefined
  }
}
