import { useMemo, useState, type KeyboardEvent } from "react"

import { takeTurns } from "~/home"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { ChannelTile, HomeAgent, HomeAsk, HomeChannel, Person } from "~/model"
import { useApp } from "~/nav"

export const DESIGNS = ["letter", "captions", "crew", "day", "goals", "map"] as const
export type Design = (typeof DESIGNS)[number]
export const DESIGN_NAMES: Record<Design, string> = { letter: "Letter", captions: "Captions", crew: "Crew", day: "Day", goals: "Goals", map: "Map" }

export function designOf(search: string): Design | null {
  const asked = new URLSearchParams(search).get("afk")
  return DESIGNS.find((d) => d === asked) ?? null
}

export interface AskAt {
  tile: ChannelTile
  ask: HomeAsk
}

export interface AgentAt {
  tile: ChannelTile
  agent: HomeAgent
  person: Pick<Person, "name" | "kind" | "harness" | "presence" | "color" | "picture" | "face" | "activity">
}

export interface Pair {
  tile: ChannelTile
  home: HomeChannel
}

export interface Away {
  pairs: Pair[]
  asks: AskAt[]
  agents: AgentAt[]
  working: number
  done: number
  red: number
}

const AGENT_RANK: Record<HomeAgent["state"], number> = { waiting: 0, working: 1, idle: 2, away: 3 }

export function useAway(): Away {
  const { app } = useApp()
  return useMemo(() => {
    const byCode = new Map(app.home.map((h) => [h.code, h]))
    const pairs = app.channels
      .filter((t) => t.state === "member")
      .map((tile) => ({ tile, home: byCode.get(tile.code) }))
      .filter((p): p is Pair => !!p.home && !p.home.loading)
      .sort((a, b) => b.home.asks.length - a.home.asks.length || b.home.working - a.home.working || b.tile.last - a.tile.last)
    const asks = takeTurns(pairs.map((p) => p.home.asks.map((ask) => ({ tile: p.tile, ask }))))
    const agents = pairs
      .flatMap((p) =>
        p.home.agents.map((agent) => {
          const known = app.channel?.code === p.tile.code ? app.channel.people.find((x) => x.name === agent.name) : undefined
          const person = known ?? { name: agent.name, kind: "agent" as const, presence: agent.state === "away" ? ("offline" as const) : ("online" as const) }
          return { tile: p.tile, agent, person }
        })
      )
      .sort((a, b) => AGENT_RANK[a.agent.state] - AGENT_RANK[b.agent.state])
    return {
      pairs,
      asks,
      agents,
      working: pairs.reduce((n, p) => n + p.home.working, 0),
      done: pairs.reduce((n, p) => n + p.home.doneToday, 0),
      red: pairs.reduce((n, p) => n + p.home.red, 0),
    }
  }, [app.channels, app.home, app.channel])
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function Answer({ at, onOpen }: { at: AskAt; onOpen: (code: string) => void }) {
  const { app } = useApp()
  const { actions } = app
  const code = at.tile.code
  const act = at.ask.act
  return (
    <span className="afk-acts" data-afk-keep="">
      {act.kind === "options" &&
        act.options.map((o) => (
          <button key={o.answer} type="button" className="btn is-small" onClick={() => actions.answerQuestion(code, at.ask.id, o.answer)}>
            {o.shown}
          </button>
        ))}
      {act.kind === "allow" && (
        <>
          <button type="button" className="btn is-small" onClick={() => actions.answerPermission(code, at.ask.id, false)}>
            Deny
          </button>
          <button type="button" className="btn is-small" onClick={() => actions.answerPermission(code, at.ask.id, true)}>
            Allow
          </button>
        </>
      )}
      {act.kind === "approve-spec" && (
        <button type="button" className="btn is-small" onClick={() => actions.approveSpec(code, act.ask, act.v)}>
          Approve
        </button>
      )}
      {act.kind === "approve-task" && (
        <button type="button" className="btn is-small" onClick={() => actions.approveTask(code, act.task, true)}>
          Approve
        </button>
      )}
      {act.kind === "open" && (
        <button type="button" className="btn is-small" onClick={() => onOpen(code)}>
          Open
        </button>
      )}
    </span>
  )
}

export function Reply({ pair, label }: { pair: Pair; label?: string }) {
  const { app, toast } = useApp()
  const [text, setText] = useState("")
  const to = pair.home.leadName
  const send = (): void => {
    const body = text.trim()
    if (!body) return
    app.actions.send(pair.tile.code, pair.home.lead ? { kind: "dm", with: pair.home.lead } : { kind: "room", room: "general" }, body)
    setText("")
    toast(to ? `Sent to ${to} in ${pair.tile.title}` : `Sent to #general in ${pair.tile.title}`)
  }
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || e.key !== "Enter" || e.shiftKey) return
    e.preventDefault()
    send()
  }
  return (
    <div className="afk-reply" data-afk-keep="">
      <textarea
        rows={1}
        value={text}
        aria-label={to ? `Message ${to} in ${pair.tile.title}` : `Write to #general in ${pair.tile.title}`}
        placeholder={label ?? (to ? `Reply to ${to}…` : "Write to #general…")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <button type="button" className={cx("afk-send", text.trim() && "is-ready")} aria-label="Send" title="Send (Enter)" disabled={!text.trim()} onClick={send}>
        <Icon name="send" size={14} />
      </button>
    </div>
  )
}
