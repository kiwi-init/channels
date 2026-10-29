import { tokensWord } from "@kiwi/core/format.ts"
import { CONTEXT_LINE } from "@kiwi/core/protocol.ts"
import type { Person, Where } from "~/model"

type Live = { text: string; busy: boolean; since?: number }

const toolName = (tool: string): string => tool.replace(/^mcp__.+?__/, "")

export function liveOf(p: Pick<Person, "activity" | "presence">): Live | null {
  const a = p.presence === "offline" ? undefined : p.activity
  const since = a?.since ? { since: a.since } : {}
  if (a?.state === "working") return { text: a.tool ? `running ${toolName(a.tool)}` : "thinking", busy: true, ...since }
  if (a?.state === "waiting") return { text: "waiting for a person", busy: false, ...since }
  return null
}

const REACH: Record<NonNullable<Person["reach"]>, string> = { listening: "listening", running: "running", wakes: "wakes on new messages" }

export function restOf(p: Pick<Person, "activity" | "reach">): string {
  if (p.activity?.state === "idle" || !p.reach) return "idle"
  return REACH[p.reach]
}

export function contextOf(p: Pick<Person, "activity">): { text: string; over: boolean } | null {
  const c = p.activity?.context
  if (!c) return null
  return { text: c.window ? `${tokensWord(c.used)} of ${tokensWord(c.window)} context` : `${tokensWord(c.used)} context`, over: c.used >= CONTEXT_LINE }
}

export function workingIn(people: readonly Person[], where: Where): Person[] {
  const here = (p: Person): boolean =>
    where.kind === "room" ? true : where.kind === "dm" ? p.name === where.with : where.kind === "theirs" ? where.between.includes(p.name) : !!p.load?.doing.includes(where.task)
  return people.filter((p) => !p.you && p.kind === "agent" && liveOf(p) && here(p))
}
