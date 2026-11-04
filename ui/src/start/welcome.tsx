import "~/styles/start.css"
import { useState } from "react"

import { takeTurns } from "~/home"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { ChannelTile, HomeAgent, HomeAsk, HomeChannel } from "~/model"
import { useApp } from "~/nav"
import { quoteOf } from "~/start/quotes"

export function Welcome() {
  const { app } = useApp()
  const tiles = app.channels.filter((t) => t.state !== "gone")
  if (!tiles.length) return <Empty />
  return <Hud tiles={tiles} home={app.home} />
}

function Empty() {
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-welcome start-home">
        <h1 className="start-title">No channels yet</h1>
        <div className="start-choices">
          <Starts />
        </div>
      </div>
    </main>
  )
}

function Starts({ quiet }: { quiet?: true }) {
  const { go } = useApp()
  return (
    <>
      <button type="button" className={quiet ? undefined : "btn is-primary"} onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
        <Icon name="plus" size={quiet ? 12 : 14} />
        New channel
      </button>
      {quiet && <span aria-hidden="true">·</span>}
      <button type="button" className={quiet ? undefined : "btn"} onClick={() => go({ to: "dialog", dialog: "join" })}>
        {!quiet && <Icon name="link" size={14} />}
        Join with a code
      </button>
    </>
  )
}

const ASKS_SHOWN = 4

function Hud({ tiles, home }: { tiles: readonly ChannelTile[]; home: readonly HomeChannel[] }) {
  const [all, setAll] = useState(false)
  const now = useNow(60_000)
  const quote = quoteOf(now)
  const byCode = new Map(home.map((h) => [h.code, h]))
  const members = tiles.filter((t) => t.state === "member")
  const asks = takeTurns(members.map((t) => (byCode.get(t.code)?.asks ?? []).map((ask) => ({ tile: t, ask }))))
  const shown = all ? asks : asks.slice(0, ASKS_SHOWN)
  return (
    <main className="start-area home-area">
      <div className="start-drag" />
      <div className="calm">
        <figure className="calm-quote">
          <blockquote>{quote.text}</blockquote>
          <figcaption>
            {quote.by}, <cite>{quote.in}</cite>
          </figcaption>
        </figure>
        {asks.length > 0 && (
          <section className="calm-sec" aria-label="Waiting on you">
            <h2 className="calm-head">
              Waiting on you <span className="num">{asks.length}</span>
            </h2>
            <ol className="calm-list">
              {shown.map(({ tile, ask }) => (
                <AskRow key={`${tile.code}:${ask.id}`} tile={tile} ask={ask} now={now} />
              ))}
            </ol>
            {asks.length > ASKS_SHOWN && (
              <button type="button" className="calm-more" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `${asks.length - ASKS_SHOWN} more`}
              </button>
            )}
          </section>
        )}
        {tiles.map((t) => (
          <ChannelPart key={t.code} tile={t} summary={byCode.get(t.code)} now={now} />
        ))}
        <p className="calm-starts">
          <Starts quiet />
        </p>
      </div>
    </main>
  )
}

function AskRow({ tile, ask, now }: { tile: ChannelTile; ask: HomeAsk; now: number }) {
  const { app, go } = useApp()
  const { actions } = app
  const code = tile.code
  const open = () => {
    go({ to: "channel", code })
    go({ to: "tab", tab: "needs" })
  }
  const act = ask.act
  return (
    <li className="calm-ask">
      <button type="button" className="calm-ask-body" title={`Open in ${tile.title}`} onClick={open}>
        <span className="calm-ask-text">{ask.text}</span>
        <span className="calm-meta">
          {tile.title} · {ask.what} · <time dateTime={new Date(ask.at).toISOString()}>{ago(ask.at, now)}</time>
        </span>
      </button>
      <span className="calm-acts">
        {act.kind === "options" &&
          act.options.map((o) => (
            <button key={o} type="button" className="calm-act" onClick={() => actions.answerQuestion(code, ask.id, o)}>
              {o}
            </button>
          ))}
        {act.kind === "allow" && (
          <>
            <button type="button" className="calm-act" onClick={() => actions.answerPermission(code, ask.id, false)}>
              Deny
            </button>
            <button type="button" className="calm-act" onClick={() => actions.answerPermission(code, ask.id, true)}>
              Allow
            </button>
          </>
        )}
        {act.kind === "approve-spec" && (
          <button type="button" className="calm-act" onClick={() => actions.approveSpec(code, act.ask, act.v)}>
            Approve
          </button>
        )}
        {act.kind === "approve-task" && (
          <button type="button" className="calm-act" onClick={() => actions.approveTask(code, act.task, true)}>
            Approve
          </button>
        )}
        {act.kind === "open" && (
          <button type="button" className="calm-act" onClick={open}>
            Open
          </button>
        )}
      </span>
    </li>
  )
}

function stateOf(tile: ChannelTile, summary: HomeChannel | undefined): string {
  if (tile.state === "waiting") return "waiting to be let in"
  if (!summary || summary.loading) return "opening"
  if (summary.doneToday) return `${summary.doneToday} done today`
  return summary.working || summary.red ? "" : "quiet"
}

function restLine(agents: readonly HomeAgent[]): string {
  const idle = agents.filter((a) => a.state === "idle").map((a) => a.nick)
  const away = agents.filter((a) => a.state === "away").map((a) => a.nick)
  return [idle.length ? `${idle.join(", ")} idle` : null, away.length ? `${away.join(", ")} away` : null].filter(Boolean).join(" · ")
}

function ChannelPart({ tile, summary, now }: { tile: ChannelTile; summary: HomeChannel | undefined; now: number }) {
  const { go } = useApp()
  const needs = summary ? summary.asks.length : tile.needsYou
  const open = () => go({ to: "channel", code: tile.code })
  const agents = summary?.agents ?? []
  const active = agents.filter((a) => a.state === "working" || a.state === "waiting")
  const rest = restLine(agents)
  const state = stateOf(tile, summary)
  return (
    <section className="calm-sec" aria-label={tile.title}>
      <button type="button" className="calm-chan" onClick={open}>
        <span className="calm-chan-name">{tile.title}</span>
        {state && <span className="calm-meta">{state}</span>}
        {summary?.red ? <span className="calm-meta tone-alert">{summary.red === 1 ? "1 check red" : `${summary.red} checks red`}</span> : null}
        {needs > 0 && <span className="calm-needs">{needs === 1 ? "1 needs you" : `${needs} need you`}</span>}
      </button>
      {active.length > 0 && (
        <ul className="calm-list">
          {active.map((a) => (
            <AgentLine key={a.name} tile={tile} agent={a} now={now} />
          ))}
        </ul>
      )}
      {rest && <p className="calm-rest">{rest}</p>}
    </section>
  )
}

function AgentLine({ tile, agent, now }: { tile: ChannelTile; agent: HomeAgent; now: number }) {
  const { go } = useApp()
  const open = () => {
    go({ to: "channel", code: tile.code })
    if (agent.task) go({ to: "panel", panel: { kind: "task", task: agent.task.id } })
    else go({ to: "modal", modal: { kind: "person", name: agent.name } })
  }
  return (
    <li>
      <button type="button" className={cx("calm-agent", `is-${agent.state}`)} onClick={open}>
        <span className="calm-dot" aria-hidden="true" />
        <span className="calm-agent-name">{agent.nick}</span>
        <span className="calm-agent-task">{agent.task ? agent.task.title : ""}</span>
        <span className="calm-agent-doing">
          {agent.doing}
          {agent.since ? ` · ${ago(agent.since, now)}` : ""}
        </span>
      </button>
    </li>
  )
}
