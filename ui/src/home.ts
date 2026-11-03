import { liveOf } from "~/doing"
import type { Ask, Channel, HomeAct, HomeAsk, HomeChannel } from "~/model"
import { nickname } from "~/names"
import { openAsks } from "~/needs/open"

const CLIP = 140
const OPTIONS_SHOWN = 4

type Source = Pick<Channel, "code" | "title" | "lead" | "people" | "asks" | "specs" | "tasks" | "nicknames" | "loading">

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= CLIP ? line : `${line.slice(0, CLIP - 1).trimEnd()}…`
}

function lineOf(c: Source, a: Ask): { text: string; act: HomeAct } {
  switch (a.kind) {
    case "question": {
      const plain = !a.irreversible && !a.step && !a.handoff && a.options.length > 0 && a.options.length <= OPTIONS_SHOWN
      return { text: clip(a.text), act: plain ? { kind: "options", options: a.options } : { kind: "open" } }
    }
    case "permission":
      return { text: clip(`${nickname(c, a.from)} ${a.title}: ${a.summary || a.code}`), act: a.canAllow ? { kind: "allow" } : { kind: "open" } }
    case "join":
      return { text: `${a.name} wants to join`, act: { kind: "open" } }
    case "review": {
      const task = c.tasks.find((t) => t.id === a.task)
      return { text: clip(`Review T${a.task}${task ? ` ${task.title}` : ""}`), act: task ? { kind: "approve-task", task: a.task } : { kind: "open" } }
    }
    case "spec": {
      const spec = c.specs?.find((s) => s.ask === a.ask)
      const title = spec ? ` “${spec.title}”` : ""
      if (a.why === "result") return { text: clip(`Spec #${a.ask}${title} is done: check it`), act: { kind: "open" } }
      const text = clip(a.why === "changed" ? `Spec #${a.ask}${title} changed` : `Approve spec #${a.ask}${title}`)
      return { text, act: spec ? { kind: "approve-spec", ask: a.ask, v: spec.v } : { kind: "open" } }
    }
  }
}

export function homeOf(c: Source): HomeChannel {
  const asks = openAsks(c)
    .sort((a, b) => a.at - b.at)
    .map((a): HomeAsk => ({ id: a.id, at: a.at, ...lineOf(c, a) }))
  const working = c.people.filter((p) => p.kind === "agent" && !p.left && liveOf(p)?.busy).length
  const lead = c.lead ?? null
  return {
    code: c.code,
    title: c.title,
    lead,
    leadName: lead ? nickname(c, lead) : null,
    working,
    asks,
    ...(c.loading ? { loading: true as const } : {}),
  }
}
