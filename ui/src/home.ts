import "~/i18n/en/live-later"
import { liveOf, restOf } from "~/doing"
import type { Ask, Channel, HomeAct, HomeAgent, HomeAsk, HomeChannel, Person } from "~/model"
import { nickname } from "~/names"
import { openAsks } from "~/needs/open"
import { nowOf, stageWords } from "~/now"
import { wordsPlain, wordsRaw } from "~/words"
import { t } from "~/i18n/i18n"

const CLIP = 280
const QUESTION_CLIP = 1200
const OPTIONS_SHOWN = 4

type Source = Pick<Channel, "code" | "title" | "lead" | "people" | "asks" | "specs" | "tasks" | "nicknames" | "loading">

function clip(text: string, max = CLIP): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

function lineOf(c: Source, a: Ask): { what: string; text: string; act: HomeAct } {
  switch (a.kind) {
    case "question": {
      const plain = !a.irreversible && !a.step && !a.handoff && a.options.length > 0 && a.options.length <= OPTIONS_SHOWN
      const options = a.options.map((o) => ({ shown: wordsPlain(o, c.nicknames), answer: wordsRaw(o) }))
      return { what: t("live.home.asks", { who: nickname(c, a.from) }), text: clip(wordsPlain(a.text, c.nicknames), QUESTION_CLIP), act: plain ? { kind: "options", options } : { kind: "open" } }
    }
    case "permission":
      return { what: `${nickname(c, a.from)} ${a.title}`, text: clip(a.summary || a.code), act: a.canAllow ? { kind: "allow" } : { kind: "open" } }
    case "join":
      return { what: t("live.home.wants.to.join"), text: a.name, act: { kind: "open" } }
    case "review": {
      const task = c.tasks.find((t) => t.id === a.task)
      return {
        what: t("live.home.review", { id: String(a.task) }),
        text: clip(task ? wordsPlain(task.title, c.nicknames) : `T${a.task}`),
        act: task ? { kind: "approve-task", task: a.task } : { kind: "open" },
      }
    }
    case "spec": {
      const spec = c.specs?.find((s) => s.ask === a.ask)
      const ask = String(a.ask)
      const text = clip(spec ? wordsPlain(spec.title, c.nicknames) : t("live.home.spec", { ask }))
      if (a.why === "result") return { what: t("live.home.spec.done", { ask }), text, act: { kind: "open" } }
      if (a.why === "changed") return { what: t("live.home.spec.changed", { ask }), text, act: spec ? { kind: "approve-spec", ask: a.ask, v: spec.v } : { kind: "open" } }
      return { what: t("live.home.spec.approve", { ask }), text, act: spec ? { kind: "approve-spec", ask: a.ask, v: spec.v } : { kind: "open" } }
    }
  }
}

const AGENT_ORDER: Record<HomeAgent["state"], number> = { working: 0, waiting: 1, idle: 2, away: 3 }

function agentOf(c: Source, p: Person): HomeAgent {
  const live = liveOf(p)
  const state: HomeAgent["state"] = p.presence === "offline" ? "away" : live?.busy ? "working" : live ? "waiting" : "idle"
  const task = c.tasks
    .filter((t) => t.owner === p.name && !t.archived && !t.cancelled && (t.status === "doing" || t.status === "review" || t.status === "waiting"))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return {
    name: p.name,
    nick: nickname(c, p.name),
    person: p,
    state,
    doing: live?.text ?? (state === "away" ? t("doing.offline") : restOf(p)),
    ...(live?.since ? { since: live.since } : {}),
    task: task ? { id: task.id, title: wordsPlain(task.title, c.nicknames) } : null,
  }
}

function agentsOf(c: Source): HomeAgent[] {
  return c.people
    .filter((p) => p.kind === "agent" && !p.you && !p.left)
    .map((p) => agentOf(c, p))
    .sort((a, b) => AGENT_ORDER[a.state] - AGENT_ORDER[b.state] || a.nick.localeCompare(b.nick))
}

export function homeOf(c: Source): HomeChannel {
  const asks = openAsks(c)
    .sort((a, b) => a.at - b.at)
    .map((a): HomeAsk => ({ id: a.id, at: a.at, ...lineOf(c, a) }))
  const agents = agentsOf(c)
  const now = nowOf({ tasks: c.tasks })
  const lead = c.lead ?? null
  return {
    code: c.code,
    title: c.title,
    lead,
    leadName: lead ? nickname(c, lead) : null,
    asks,
    doneToday: now.doneCount,
    red: c.tasks.filter((t) => !t.archived && !t.cancelled && t.status !== "done" && stageWords(t).red).length,
    agents,
    ...(c.loading ? { loading: true as const } : {}),
  }
}

export function takeTurns<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) out.push(...lists.flatMap((l) => l.slice(i, i + 1)))
  return out
}
