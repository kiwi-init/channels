import { tokensWord } from "@kiwi/core/format.ts"
import { CONTEXT_LINE } from "@kiwi/core/protocol.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import type { Person, Where } from "~/model"

type Live = { text: string; busy: boolean; since?: number }

const toolName = (tool: string): string => tool.replace(/^mcp__.+?__/, "")

export function liveOf(p: Pick<Person, "activity" | "presence">): Live | null {
  const a = p.presence === "offline" ? undefined : p.activity
  const since = a?.since ? { since: a.since } : {}
  if (a?.state === "working") return { text: a.tool ? t("doing.running", { tool: toolName(a.tool) }) : t("doing.thinking"), busy: true, ...since }
  if (a?.state === "waiting") return { text: t("doing.waiting"), busy: false, ...since }
  return null
}

export const unsureOf = (p: Pick<Person, "activity" | "presence" | "kind">): boolean => p.kind === "agent" && p.presence !== "offline" && p.activity?.state === "unknown"

const REACH: Record<NonNullable<Person["reach"]>, Key> = { listening: "doing.listening", running: "doing.reach.running", wakes: "doing.wakes" }

export function restOf(p: Pick<Person, "activity" | "reach">): string {
  if (p.activity?.state === "unknown") return t("doing.unknown")
  if (p.activity?.state === "idle" || !p.reach) return t("doing.idle")
  return t(REACH[p.reach])
}

export function contextOf(p: Pick<Person, "activity">): { text: string; over: boolean } | null {
  const c = p.activity?.context
  if (!c) return null
  return { text: c.window ? t("doing.context.of", { used: tokensWord(c.used), window: tokensWord(c.window) }) : t("doing.context", { used: tokensWord(c.used) }), over: c.used >= CONTEXT_LINE }
}

export function workingIn(people: readonly Person[], where: Where): Person[] {
  const here = (p: Person): boolean =>
    where.kind === "room" ? true : where.kind === "dm" ? p.name === where.with : where.kind === "theirs" ? where.between.includes(p.name) : !!p.load?.doing.includes(where.task)
  return people.filter((p) => !p.you && p.kind === "agent" && liveOf(p) && here(p))
}
