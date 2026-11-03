import "~/styles/start.css"
import { useState } from "react"

import { takeTurns } from "~/home"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { ChannelTile, HomeAsk, HomeChannel, HomeTask } from "~/model"
import { useApp } from "~/nav"
import { Face } from "~/shell/rail"

const ASKS_SHOWN = 3

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
      <button type="button" className={quiet ? "home-start-btn" : "btn is-primary"} onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
        <Icon name="plus" size={quiet ? 12 : 14} />
        New channel
      </button>
      {quiet && <span aria-hidden="true">·</span>}
      <button type="button" className={quiet ? "home-start-btn" : "btn"} onClick={() => go({ to: "dialog", dialog: "join" })}>
        {!quiet && <Icon name="link" size={14} />}
        Join with a code
      </button>
    </>
  )
}

function Hud({ tiles, home }: { tiles: readonly ChannelTile[]; home: readonly HomeChannel[] }) {
  const [all, setAll] = useState(false)
  const now = useNow(60_000)
  const byCode = new Map(home.map((h) => [h.code, h]))
  const members = tiles.filter((t) => t.state === "member")
  const asks = takeTurns(members.map((t) => (byCode.get(t.code)?.asks ?? []).map((ask) => ({ tile: t, ask }))))
  const shown = all ? asks : asks.slice(0, ASKS_SHOWN)
  const hidden = asks.length - shown.length
  return (
    <main className="start-area home-area">
      <div className="start-drag" />
      <div className="home">
        {asks.length > 0 && (
          <section className="home-sec" aria-label="Waiting on you">
            <h2 className="home-head">
              Waiting on you <span className="home-head-n num">{asks.length}</span>
            </h2>
            <ol className="home-asks">
              {shown.map(({ tile, ask }) => (
                <AskRow key={`${tile.code}:${ask.id}`} tile={tile} ask={ask} />
              ))}
            </ol>
            {(hidden > 0 || all) && asks.length > ASKS_SHOWN && (
              <button type="button" className="home-more" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show ${hidden} more`}
              </button>
            )}
          </section>
        )}
        <section className="home-sec" aria-label="Channels">
          <h2 className="home-head">Channels</h2>
          <ul className="home-cards">
            {tiles.map((t) => (
              <ChannelCard key={t.code} tile={t} summary={byCode.get(t.code)} now={now} />
            ))}
          </ul>
        </section>
        <p className="home-start">
          <Starts quiet />
        </p>
      </div>
    </main>
  )
}

function AskRow({ tile, ask }: { tile: ChannelTile; ask: HomeAsk }) {
  const { app, go } = useApp()
  const { actions } = app
  const code = tile.code
  const open = () => {
    go({ to: "channel", code })
    go({ to: "tab", tab: "needs" })
  }
  const act = ask.act
  return (
    <li className="home-ask">
      <button type="button" className="home-ask-body" title={`Open in ${tile.title}`} onClick={open}>
        <span className="home-ask-meta">
          <span className="home-ask-where">{tile.title}</span>
          <span aria-hidden="true">·</span>
          <span className="home-ask-what">{ask.what}</span>
        </span>
        <span className="home-ask-text">{ask.text}</span>
      </button>
      <span className="home-ask-acts">
        {act.kind === "options" &&
          act.options.map((o, i) => (
            <button key={o} type="button" className={cx("btn is-small", i === 0 && "is-primary")} onClick={() => actions.answerQuestion(code, ask.id, o)}>
              {o}
            </button>
          ))}
        {act.kind === "allow" && (
          <>
            <button type="button" className="btn is-small" onClick={() => actions.answerPermission(code, ask.id, false)}>
              Deny
            </button>
            <button type="button" className="btn is-small is-primary" onClick={() => actions.answerPermission(code, ask.id, true)}>
              Allow
            </button>
          </>
        )}
        {act.kind === "approve-spec" && (
          <button type="button" className="btn is-small is-primary" onClick={() => actions.approveSpec(code, act.ask, act.v)}>
            Approve
          </button>
        )}
        {act.kind === "approve-task" && (
          <button type="button" className="btn is-small is-primary" onClick={() => actions.approveTask(code, act.task, true)}>
            Approve
          </button>
        )}
        {act.kind === "open" && (
          <button type="button" className="btn is-small" onClick={open}>
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
  const words = [summary.working ? `${summary.working} working` : null, summary.doneToday ? `${summary.doneToday} done today` : null].filter(Boolean)
  return words.length ? words.join(" · ") : "quiet"
}

function ChannelCard({ tile, summary, now }: { tile: ChannelTile; summary: HomeChannel | undefined; now: number }) {
  const { go } = useApp()
  const needs = summary ? summary.asks.length : tile.needsYou
  const working = summary?.working ?? 0
  const open = () => go({ to: "channel", code: tile.code })
  const openTask = (t: HomeTask) => {
    go({ to: "channel", code: tile.code })
    go({ to: "panel", panel: { kind: "task", task: t.id } })
  }
  const moving = summary?.moving ?? []
  const said = summary?.said ?? null
  return (
    <li className={cx("home-card", tile.state === "waiting" && "is-waiting")}>
      <button type="button" className="home-card-head" onClick={open}>
        <span className="home-face" aria-hidden="true">
          <Face tile={tile} />
        </span>
        <span className="home-card-name">{tile.title}</span>
        <span className={cx("home-card-state", working > 0 && "is-working")}>{stateOf(tile, summary)}</span>
        {needs > 0 && <span className="home-card-needs">{needs === 1 ? "1 needs you" : `${needs} need you`}</span>}
      </button>
      {moving.length > 0 && (
        <ul className="home-moving" aria-label="In progress">
          {moving.map((t) => (
            <li key={t.id}>
              <button type="button" className="home-task" onClick={() => openTask(t)}>
                <span className={cx("home-dot", t.busy && "is-working")} aria-hidden="true" />
                <span className="home-task-id">T{t.id}</span>
                <span className="home-task-title">{t.title}</span>
                <span className={cx("home-task-state", t.red && "tone-alert")}>{[t.who, t.state].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
          {summary && summary.more > 0 && (
            <li>
              <button
                type="button"
                className="home-task-more"
                onClick={() => {
                  go({ to: "channel", code: tile.code })
                  go({ to: "tab", tab: "tasks" })
                }}
              >
                {summary.more} more in progress
              </button>
            </li>
          )}
        </ul>
      )}
      {said && (
        <button type="button" className="home-said" onClick={open}>
          <span className="home-said-from">{said.from}</span>
          <span className="home-said-text">{said.text}</span>
          <time className="home-said-at" dateTime={new Date(said.at).toISOString()}>
            {ago(said.at, now)}
          </time>
        </button>
      )}
    </li>
  )
}
