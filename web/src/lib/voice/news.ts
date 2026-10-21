import { ignored, type Message } from "@kiwi/core/protocol.ts"
import { holdsWork, type ChannelState } from "@kiwi/core/state.ts"

const OPEN_TASKS = 8
const RED = new Set(["failure", "timed_out", "startup_failure"])

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

function forMe(m: Message, me: string): boolean {
  return m.from !== me && (!!m.to?.includes(me) || !!m.to?.includes("*"))
}

export function voiceSnapshot(state: ChannelState, me: string, nameOf: (name: string) => string, channel: string): string {
  const lines = [`Channel: ${channel}. You speak with ${nameOf(me)}.`]
  if (state.lead) lines.push(`Lead: ${nameOf(state.lead)}.`)
  if (state.hold) lines.push(`The agents are paused${state.hold.note ? `: ${clip(state.hold.note, 120)}` : ""}.`)
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  if (open.length) {
    lines.push(`Open tasks (${open.length}):`)
    for (const t of open.slice(0, OPEN_TASKS)) lines.push(`- T${t.id} ${clip(t.title, 100)} (${t.state === "todo" ? "open" : t.state}${t.owner ? `, ${nameOf(t.owner)}` : ""})`)
    if (open.length > OPEN_TASKS) lines.push(`- and ${open.length - OPEN_TASKS} more`)
  } else lines.push("No open tasks.")
  const asks = state.openAsks.filter((m) => forMe(m, me) && holdsWork(state, m))
  if (asks.length) {
    lines.push(`Waiting on ${nameOf(me)} (${asks.length}):`)
    for (const m of asks.slice(0, 3)) lines.push(`- ${nameOf(m.from)} asks: ${clip(m.body, 160)}`)
  }
  return lines.join("\n")
}

export function voiceNewsFeed(me: string, nameOf: (name: string) => string): (m: Message, state: ChannelState) => string | null {
  const told = new Set<string>()
  const once = (key: string, text: string): string | null => {
    if (told.has(key)) return null
    told.add(key)
    return text
  }
  return (m, state) => {
    if (ignored(state.trust.get(m.seq))) return null
    const ev = m.ev
    if (ev?.op === "task.update" && ev.state === "done") {
      const t = state.tasks.get(ev.task)
      if (!t) return null
      return once(`task:${t.id}`, `T${t.id} is ${t.cancelled ? "cancelled" : "done"}: ${clip(t.title, 120)} (${nameOf(m.from)}).`)
    }
    if (m.kind === "done") {
      const id = /^T(\d+)\b/.exec(m.body)?.[1]
      return once(id ? `task:${id}` : `done:${m.seq}`, `Done: ${clip(m.body, 240)}`)
    }
    if (ev?.op === "github") {
      const red = ev.items.filter((i) => (i.event === "check_run" || i.event === "workflow_run") && !!i.conclusion && RED.has(i.conclusion))
      const said = red
        .map((i) => once(`ci:${i.repo}:${i.sha ?? i.branch ?? ""}:${i.name ?? i.event}`, `CI is red: ${i.name ?? "a check"} on ${i.branch ?? i.repo}.`))
        .filter((s): s is string => s !== null)
      return said.length ? said.join(" ") : null
    }
    if (m.kind !== "event" && forMe(m, me) && state.openAsks.some((a) => a.seq === m.seq) && holdsWork(state, m)) {
      const options = m.choices?.length ? ` Options: ${m.choices.map((c) => clip(c, 80)).join("; ")}.` : ""
      return once(`ask:${m.seq}`, `${nameOf(m.from)} asks ${nameOf(me)}: ${clip(m.body, 240)}${options}`)
    }
    return null
  }
}
