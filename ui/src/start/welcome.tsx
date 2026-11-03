import "~/styles/start.css"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { ChannelTile, HomeAsk, HomeChannel } from "~/model"
import { useApp } from "~/nav"

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
  const byCode = new Map(home.map((h) => [h.code, h]))
  const members = tiles.filter((t) => t.state === "member")
  const asks = members.flatMap((t) => (byCode.get(t.code)?.asks ?? []).map((ask) => ({ tile: t, ask })))
  return (
    <main className="start-area home-area">
      <div className="start-drag" />
      <div className="home">
        {asks.length > 0 && (
          <ol className="home-asks" aria-label="Waiting on you">
            {asks.map(({ tile, ask }) => (
              <AskRow key={`${tile.code}:${ask.id}`} tile={tile} ask={ask} />
            ))}
          </ol>
        )}
        <ul className="home-chips" aria-label="Your channels">
          {tiles.map((t) => (
            <li key={t.code}>
              <Chip tile={t} summary={byCode.get(t.code)} />
            </li>
          ))}
        </ul>
      </div>
      <p className="home-start">
        <Starts quiet />
      </p>
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
      <button type="button" className="home-ask-where" title={`Open ${tile.title}`} onClick={open}>
        {tile.title}
      </button>
      <span className="home-ask-text" title={ask.text}>
        {ask.text}
      </span>
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

function Chip({ tile, summary }: { tile: ChannelTile; summary: HomeChannel | undefined }) {
  const { go } = useApp()
  const needs = summary ? summary.asks.length : tile.needsYou
  const working = summary?.working ?? 0
  const state = tile.state === "waiting" ? "waiting to be let in" : working ? `${working} working` : "quiet"
  return (
    <button type="button" className="home-chip" onClick={() => go({ to: "channel", code: tile.code })}>
      <span className={cx("home-dot", tile.state === "waiting" ? "is-waiting" : working ? "is-working" : "is-quiet")} aria-hidden="true" />
      <span className="home-chip-name">{tile.title}</span>
      <span className="home-chip-state">· {state}</span>
      {needs > 0 && (
        <span className="home-chip-needs" aria-label={`${needs} need you`}>
          {needs}
        </span>
      )}
    </button>
  )
}
