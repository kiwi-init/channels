import "~/styles/start.css"
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

import { takeTurns } from "~/home"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { ChannelTile, HomeAgent, HomeAsk, HomeChannel } from "~/model"
import { useApp } from "~/nav"
import { onboarded } from "~/start/onboarded"
import { Onboarding } from "~/start/onboarding"

export function Welcome() {
  const { app } = useApp()
  const tiles = app.channels.filter((t) => t.state !== "gone")
  if (!tiles.length) return <Empty />
  return <Hud tiles={tiles} home={app.home} />
}

function Empty() {
  const [intro, setIntro] = useState(() => !onboarded(false))
  return (
    <main className="start-area">
      {intro && <Onboarding onDone={() => setIntro(false)} />}
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
  useEffect(() => void onboarded(true), [])
  const now = useNow(60_000)
  const byCode = new Map(home.map((h) => [h.code, h]))
  const members = tiles.filter((t) => t.state === "member")
  const asks = takeTurns(members.map((t) => (byCode.get(t.code)?.asks ?? []).map((ask) => ({ tile: t, ask }))))
  const shown = all ? asks : asks.slice(0, ASKS_SHOWN)
  const needs = (t: ChannelTile) => byCode.get(t.code)?.asks.length ?? t.needsYou
  const first = [...tiles].sort((a, b) => Number(needs(b) > 0) - Number(needs(a) > 0))
  const busy = first.filter((t) => isBusy(byCode.get(t.code)))
  const quiet = first.filter((t) => !isBusy(byCode.get(t.code)))
  return (
    <main className="start-area home-area">
      <div className="start-drag" />
      <div className="calm">
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
        {busy.map((t) => (
          <ChannelPart key={t.code} tile={t} summary={byCode.get(t.code)} />
        ))}
        {quiet.length > 0 && (
          <section className="calm-sec" aria-label="Quiet channels">
            <ul className="calm-list">
              {quiet.map((t) => (
                <QuietRow key={t.code} tile={t} summary={byCode.get(t.code)} />
              ))}
            </ul>
          </section>
        )}
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
  const text = useRef<HTMLSpanElement>(null)
  const [long, setLong] = useState(false)
  const [full, setFull] = useState(false)
  useLayoutEffect(() => {
    const el = text.current
    if (!el || full) return
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [ask.text, full])
  return (
    <li className={cx("calm-ask", act.kind === "options" && "has-options")}>
      <button type="button" className="calm-ask-body" title={`Open in ${tile.title}`} onClick={open}>
        <span ref={text} className={cx("calm-ask-text", full && "is-full")}>
          {ask.text}
        </span>
      </button>
      <span className="calm-meta">
        {tile.title} · {ask.what} · <time dateTime={new Date(ask.at).toISOString()}>{ago(ask.at, now)}</time>
        {(long || full) && (
          <>
            {" · "}
            <button type="button" className="calm-more-inline" aria-expanded={full} onClick={() => setFull(!full)}>
              {full ? "Show less" : "Show all"}
            </button>
          </>
        )}
      </span>
      <span className="calm-acts">
        {act.kind === "options" &&
          act.options.map((o) => (
            <button key={o.answer} type="button" className="calm-opt" onClick={() => actions.answerQuestion(code, ask.id, o.answer)}>
              {o.shown}
            </button>
          ))}
        {act.kind === "allow" && (
          <>
            <button type="button" className="calm-opt" onClick={() => actions.answerPermission(code, ask.id, false)}>
              Deny
            </button>
            <button type="button" className="calm-opt" onClick={() => actions.answerPermission(code, ask.id, true)}>
              Allow
            </button>
          </>
        )}
        {act.kind === "approve-spec" && (
          <button type="button" className="calm-opt" onClick={() => actions.approveSpec(code, act.ask, act.v)}>
            Approve
          </button>
        )}
        {act.kind === "approve-task" && (
          <button type="button" className="calm-opt" onClick={() => actions.approveTask(code, act.task, true)}>
            Approve
          </button>
        )}
        {act.kind === "open" && (
          <button type="button" className="calm-opt" onClick={open}>
            Open
          </button>
        )}
      </span>
    </li>
  )
}

function isBusy(summary: HomeChannel | undefined): boolean {
  return !!summary?.agents.some((a) => a.state === "working" || a.state === "waiting")
}

function stateOf(tile: ChannelTile, summary: HomeChannel | undefined): string {
  if (tile.state === "waiting") return "waiting to be let in"
  if (!summary || summary.loading) return "opening"
  return summary.doneToday ? `${summary.doneToday} done today` : ""
}

function count(names: readonly string[], word: string): string | null {
  if (!names.length) return null
  return names.length <= 2 ? `${names.join(", ")} ${word}` : `${names.length} ${word}`
}

function restLine(agents: readonly HomeAgent[]): string {
  const idle = agents.filter((a) => a.state === "idle").map((a) => a.nick)
  const away = agents.filter((a) => a.state === "away").map((a) => a.nick)
  return [count(idle, "idle"), count(away, "away")].filter(Boolean).join(" · ")
}

function Needs({ n }: { n: number }) {
  return n > 0 ? <span className="calm-needs">{n === 1 ? "1 needs you" : `${n} need you`}</span> : null
}

function Red({ summary }: { summary: HomeChannel | undefined }) {
  return summary?.red ? <span className="calm-meta tone-alert">{summary.red === 1 ? "1 check red" : `${summary.red} checks red`}</span> : null
}

function MessageLead({ tile, summary, writing, onWriting }: { tile: ChannelTile; summary: HomeChannel | undefined; writing: boolean; onWriting: (on: boolean) => void }) {
  if (tile.state !== "member" || !summary || summary.loading) return null
  return (
    <button type="button" className={cx("calm-act", writing && "is-on")} onClick={() => onWriting(!writing)}>
      {summary.leadName ? `Message ${summary.leadName}` : "Message #general"}
    </button>
  )
}

function ChannelPart({ tile, summary }: { tile: ChannelTile; summary: HomeChannel | undefined }) {
  const { go } = useApp()
  const needs = summary ? summary.asks.length : tile.needsYou
  const open = () => go({ to: "channel", code: tile.code })
  const agents = summary?.agents ?? []
  const active = agents.filter((a) => a.state === "working" || a.state === "waiting")
  const rest = restLine(agents)
  const state = stateOf(tile, summary)
  const [writing, setWriting] = useState(false)
  return (
    <section className="calm-sec" aria-label={tile.title}>
      <div className="calm-chan-row">
        <button type="button" className="calm-chan" onClick={open}>
          <span className="calm-chan-name">{tile.title}</span>
          {state && <span className="calm-meta">{state}</span>}
          <Red summary={summary} />
          <Needs n={needs} />
        </button>
        <MessageLead tile={tile} summary={summary} writing={writing} onWriting={setWriting} />
      </div>
      {writing && summary && <LeadNote tile={tile} summary={summary} onDone={() => setWriting(false)} />}
      <ul className="calm-list">
        {active.map((a) => (
          <AgentLine key={a.name} tile={tile} agent={a} />
        ))}
      </ul>
      {rest && <p className="calm-rest">{rest}</p>}
    </section>
  )
}

function QuietRow({ tile, summary }: { tile: ChannelTile; summary: HomeChannel | undefined }) {
  const { go } = useApp()
  const needs = summary ? summary.asks.length : tile.needsYou
  const [writing, setWriting] = useState(false)
  const status = stateOf(tile, summary) || restLine(summary?.agents ?? [])
  return (
    <li className={cx("calm-quiet", writing && "is-writing")}>
      <div className="calm-chan-row">
        <button type="button" className="calm-chan" onClick={() => go({ to: "channel", code: tile.code })}>
          <span className="calm-chan-name">{tile.title}</span>
          {status && <span className="calm-meta">{status}</span>}
          <Red summary={summary} />
          <Needs n={needs} />
        </button>
        <MessageLead tile={tile} summary={summary} writing={writing} onWriting={setWriting} />
      </div>
      {writing && summary && <LeadNote tile={tile} summary={summary} onDone={() => setWriting(false)} />}
    </li>
  )
}

function stateWords(agent: HomeAgent): string {
  if (agent.state === "waiting") return "needs a person"
  return agent.task ? "" : "working"
}

function AgentLine({ tile, agent }: { tile: ChannelTile; agent: HomeAgent }) {
  const { go } = useApp()
  const open = () => {
    go({ to: "channel", code: tile.code })
    if (agent.task) go({ to: "panel", panel: { kind: "task", task: agent.task.id } })
    else go({ to: "modal", modal: { kind: "person", name: agent.name } })
  }
  const state = stateWords(agent)
  return (
    <li>
      <button type="button" className={cx("calm-agent", `is-${agent.state}`)} title={agent.doing} onClick={open}>
        <Avatar person={agent.person} size="sm" />
        <span className="calm-agent-name">{agent.nick}</span>
        <span className="calm-agent-task">{agent.task ? agent.task.title : ""}</span>
        {state && <span className="calm-agent-state">{state}</span>}
      </button>
    </li>
  )
}

function LeadNote({ tile, summary, onDone }: { tile: ChannelTile; summary: HomeChannel; onDone: () => void }) {
  const { app, toast } = useApp()
  const [text, setText] = useState("")
  const to = summary.leadName
  const send = () => {
    const body = text.trim()
    if (!body) return
    app.actions.send(tile.code, summary.lead ? { kind: "dm", with: summary.lead } : { kind: "room", room: "general" }, body)
    setText("")
    onDone()
    toast(to ? `Sent to ${to} in ${tile.title}` : `Sent to #general in ${tile.title}`)
  }
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === "Escape") {
      e.preventDefault()
      onDone()
      return
    }
    if (e.key !== "Enter" || e.shiftKey) return
    e.preventDefault()
    send()
  }
  return (
    <div className="calm-note">
      <textarea
        rows={1}
        autoFocus
        value={text}
        aria-label={to ? `Message ${to} in ${tile.title}` : `Write to #general in ${tile.title}`}
        placeholder={to ? `Message ${to}…` : "Write to #general…"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <button type="button" className={cx("calm-send", text.trim() && "is-ready")} aria-label="Send" title="Send (Enter)" disabled={!text.trim()} onClick={send}>
        <Icon name="send" size={14} />
      </button>
    </div>
  )
}
