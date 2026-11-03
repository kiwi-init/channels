import "~/styles/start.css"
import { takeTurns } from "~/home"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { ChannelTile, HomeAgent, HomeAsk, HomeChannel, HomeTask } from "~/model"
import { useApp } from "~/nav"
import { Face } from "~/shell/rail"

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

interface Row {
  tile: ChannelTile
  agent: HomeAgent
}

function Hud({ tiles, home }: { tiles: readonly ChannelTile[]; home: readonly HomeChannel[] }) {
  const now = useNow(30_000)
  const byCode = new Map(home.map((h) => [h.code, h]))
  const members = tiles.filter((t) => t.state === "member")
  const asks = takeTurns(members.map((t) => (byCode.get(t.code)?.asks ?? []).map((ask) => ({ tile: t, ask }))))
  const agents: Row[] = members.flatMap((t) => (byCode.get(t.code)?.agents ?? []).map((agent) => ({ tile: t, agent }))).sort((a, b) => STATE_ORDER[a.agent.state] - STATE_ORDER[b.agent.state])
  const sum = (pick: (h: HomeChannel) => number) => members.reduce((n, t) => n + (byCode.get(t.code) ? pick(byCode.get(t.code)!) : 0), 0)
  const working = sum((h) => h.working)
  const stats: Stat[] = [
    { n: asks.length, label: asks.length === 1 ? "needs you" : "need you", tone: asks.length ? "decide" : null },
    { n: working, label: "working", tone: working ? "doing" : null },
    { n: sum((h) => h.doneToday), label: "done today", tone: null },
    { n: sum((h) => h.red), label: "checks red", tone: sum((h) => h.red) ? "alert" : null },
  ]
  return (
    <main className="start-area home-area">
      <div className="start-drag" />
      <div className="cc">
        <header className="cc-top">
          <div className="cc-when">
            <span className="cc-day">{new Date(now).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span>
            <time className="cc-clock num" dateTime={new Date(now).toISOString()}>
              {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
          <dl className="cc-stats">
            {stats.map((s) => (
              <div key={s.label} className={cx("cc-stat", s.tone && `tone-${s.tone}`)}>
                <dt>{s.label}</dt>
                <dd className="num">{s.n}</dd>
              </div>
            ))}
          </dl>
          <div className="cc-starts">
            <Starts quiet />
          </div>
        </header>
        <div className="cc-grid">
          <section className="cc-panel cc-queue" aria-label="Waiting on you">
            <h2 className="cc-head">
              Waiting on you <span className="cc-head-n num">{asks.length}</span>
            </h2>
            {asks.length ? (
              <ol className="home-asks">
                {asks.map(({ tile, ask }) => (
                  <AskRow key={`${tile.code}:${ask.id}`} tile={tile} ask={ask} now={now} />
                ))}
              </ol>
            ) : (
              <p className="cc-clear">Nothing waits on you.</p>
            )}
          </section>
          <section className="cc-panel cc-agents" aria-label="Agents">
            <h2 className="cc-head">
              Agents{" "}
              <span className="cc-head-n num">
                {working}/{agents.length}
              </span>
            </h2>
            {agents.length ? (
              <ul className="cc-roster">
                {agents.map((r) => (
                  <AgentRow key={`${r.tile.code}:${r.agent.name}`} row={r} now={now} />
                ))}
              </ul>
            ) : (
              <p className="cc-clear">No agents yet.</p>
            )}
          </section>
          <section className="cc-chans" aria-label="Channels">
            <h2 className="cc-head">Channels</h2>
            <ul className="home-cards">
              {tiles.map((t) => (
                <ChannelCard key={t.code} tile={t} summary={byCode.get(t.code)} now={now} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  )
}

const STATE_ORDER: Record<HomeAgent["state"], number> = { working: 0, waiting: 1, idle: 2, away: 3 }

interface Stat {
  n: number
  label: string
  tone: "decide" | "doing" | "alert" | null
}

function AgentRow({ row, now }: { row: Row; now: number }) {
  const { go } = useApp()
  const { tile, agent } = row
  const open = () => {
    go({ to: "channel", code: tile.code })
    go({ to: "modal", modal: { kind: "person", name: agent.name } })
  }
  const openTask = (id: number) => {
    go({ to: "channel", code: tile.code })
    go({ to: "panel", panel: { kind: "task", task: id } })
  }
  return (
    <li className={cx("cc-agent", `is-${agent.state}`)}>
      <button type="button" className="cc-agent-who" onClick={open} title={`${agent.nick} in ${tile.title}`}>
        <span className="cc-pulse" aria-hidden="true" />
        <span className="cc-agent-name">{agent.nick}</span>
        <span className="cc-agent-where">{tile.title}</span>
      </button>
      {agent.task ? (
        <button type="button" className="cc-agent-task" onClick={() => openTask(agent.task!.id)} title={agent.task.title}>
          <span className="home-task-id">T{agent.task.id}</span>
          <span className="home-task-title">{agent.task.title}</span>
        </button>
      ) : (
        <span className="cc-agent-task is-none" />
      )}
      <span className="cc-agent-doing">
        {agent.doing}
        {agent.since && agent.state !== "idle" ? <span className="cc-agent-since"> · {ago(agent.since, now)}</span> : null}
      </span>
    </li>
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
    <li className="home-ask">
      <button type="button" className="home-ask-body" title={`Open in ${tile.title}`} onClick={open}>
        <span className="home-ask-meta">
          <span className="home-ask-where">{tile.title}</span>
          <span aria-hidden="true">·</span>
          <span className="home-ask-what">{ask.what}</span>
          <time className="home-ask-at" dateTime={new Date(ask.at).toISOString()}>
            {ago(ask.at, now)}
          </time>
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
        <span className="home-card-title">
          <span className="home-card-name">{tile.title}</span>
          <span className={cx("home-card-state", working > 0 && "is-working")}>{stateOf(tile, summary)}</span>
        </span>
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
