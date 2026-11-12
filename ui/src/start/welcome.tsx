import "~/i18n/en/shell-later"
import "~/styles/start.css"
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

import { takeTurns } from "~/home"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { ChannelTile, HomeAgent, HomeAsk, HomeChannel } from "~/model"
import { useApp, useGo } from "~/nav"
import { HomePage } from "~/panes/home"
import { onboarded } from "~/start/onboarded"
import { Onboarding } from "~/start/onboarding"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"

export function Welcome() {
  const { app } = useApp()
  const tiles = app.channels.filter((c) => c.state !== "gone")
  if (!tiles.length) return <Empty />
  return <HomePage tiles={tiles} home={app.home} />
}

function Empty() {
  const [intro, setIntro] = useState(() => !onboarded(false))
  return (
    <main className="start-area">
      {intro && <Onboarding onDone={() => setIntro(false)} />}
      <div className="start-drag" />
      <div className="start-welcome start-home">
        <h1 className="start-title">{t("start.welcome.no.channels")}</h1>
        <div className="start-choices">
          <Starts />
        </div>
      </div>
    </main>
  )
}

function Starts({ quiet }: { quiet?: true }) {
  const go = useGo()
  return (
    <>
      <button type="button" className={quiet ? undefined : "btn is-primary"} onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
        <Icon name="plus" size={quiet ? 12 : 14} />
        {t("start.welcome.new.channel")}
      </button>
      {quiet && <span aria-hidden="true">·</span>}
      <button type="button" className={quiet ? undefined : "btn"} onClick={() => go({ to: "dialog", dialog: "join" })}>
        {!quiet && <Icon name="link" size={14} />}
        {t("start.welcome.join")}
      </button>
    </>
  )
}

const ASKS_SHOWN = 4

export function Hud({ tiles, home }: { tiles: readonly ChannelTile[]; home: readonly HomeChannel[] }) {
  const [all, setAll] = useState(false)
  useEffect(() => void onboarded(true), [])
  const now = useNow(60_000)
  const byCode = new Map(home.map((h) => [h.code, h]))
  const members = tiles.filter((c) => c.state === "member")
  const asks = takeTurns(members.map((c) => (byCode.get(c.code)?.asks ?? []).map((ask) => ({ tile: c, ask }))))
  const shown = all ? asks : asks.slice(0, ASKS_SHOWN)
  const needs = (c: ChannelTile) => byCode.get(c.code)?.asks.length ?? c.needsYou
  const first = [...tiles].sort((a, b) => Number(needs(b) > 0) - Number(needs(a) > 0))
  const busy = first.filter((c) => isBusy(byCode.get(c.code)))
  const quiet = first.filter((c) => !isBusy(byCode.get(c.code)))
  return (
    <main className="start-area home-area">
      <div className="start-drag" />
      <div className="calm">
        {asks.length > 0 && (
          <section className="calm-sec" aria-label={t("start.welcome.waiting.on.you")}>
            <h2 className="calm-head">{tr("start.welcome.waiting.head", { n: <span className="num">{asks.length}</span> })}</h2>
            <ol className="calm-list">
              {shown.map(({ tile, ask }) => (
                <AskRow key={`${tile.code}:${ask.id}`} tile={tile} ask={ask} now={now} />
              ))}
            </ol>
            {asks.length > ASKS_SHOWN && (
              <button type="button" className="calm-more" onClick={() => setAll(!all)}>
                {all ? t("start.welcome.show.fewer") : t("start.welcome.more", { count: asks.length - ASKS_SHOWN })}
              </button>
            )}
          </section>
        )}
        {busy.map((c) => (
          <ChannelPart key={c.code} tile={c} summary={byCode.get(c.code)} />
        ))}
        {quiet.length > 0 && (
          <section className="calm-sec" aria-label={t("start.welcome.quiet")}>
            <ul className="calm-list">
              {quiet.map((c) => (
                <QuietRow key={c.code} tile={c} summary={byCode.get(c.code)} />
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
      <button type="button" className="calm-ask-body" title={t("start.welcome.open.in", { name: tile.title })} onClick={open}>
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
              {full ? t("start.welcome.show.less") : t("start.welcome.show.all")}
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
        {act.kind !== "options" && (
          <button type="button" className="calm-opt" onClick={open}>
            {t("start.welcome.open")}
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
  if (tile.state === "waiting") return t("start.welcome.state.waiting")
  if (!summary || summary.loading) return t("start.welcome.state.opening")
  return summary.doneToday ? t("start.welcome.state.done.today", { count: summary.doneToday }) : ""
}

function count(names: readonly string[], named: Key, counted: Key): string | null {
  if (!names.length) return null
  return names.length <= 2 ? t(named, { names: names.join(t("start.welcome.names.sep")) }) : t(counted, { count: names.length })
}

function restLine(agents: readonly HomeAgent[]): string {
  const idle = agents.filter((a) => a.state === "idle").map((a) => a.nick)
  const away = agents.filter((a) => a.state === "away").map((a) => a.nick)
  return [count(idle, "start.welcome.rest.idle.named", "start.welcome.rest.idle"), count(away, "start.welcome.rest.away.named", "start.welcome.rest.away")].filter(Boolean).join(" · ")
}

function Needs({ n }: { n: number }) {
  return n > 0 ? <span className="calm-needs">{t("start.welcome.needs.you", { count: n })}</span> : null
}

function Red({ summary }: { summary: HomeChannel | undefined }) {
  return summary?.red ? <span className="calm-meta tone-alert">{t("start.welcome.checks.red", { count: summary.red })}</span> : null
}

function MessageLead({ tile, summary, writing, onWriting }: { tile: ChannelTile; summary: HomeChannel | undefined; writing: boolean; onWriting: (on: boolean) => void }) {
  if (tile.state !== "member" || !summary || summary.loading) return null
  return (
    <button type="button" className={cx("calm-act", writing && "is-on")} onClick={() => onWriting(!writing)}>
      {summary.leadName ? t("start.welcome.message.lead", { name: summary.leadName }) : t("start.welcome.message.general")}
    </button>
  )
}

function ChannelPart({ tile, summary }: { tile: ChannelTile; summary: HomeChannel | undefined }) {
  const go = useGo()
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
  const go = useGo()
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
  if (agent.state === "waiting") return t("start.welcome.agent.needs.person")
  return agent.task ? "" : t("start.welcome.agent.working")
}

function AgentLine({ tile, agent }: { tile: ChannelTile; agent: HomeAgent }) {
  const go = useGo()
  const open = () => {
    go({ to: "channel", code: tile.code })
    if (agent.task) go({ to: "panel", panel: { kind: "task", task: agent.task.id } })
    else go({ to: "where", where: { kind: "dm", with: agent.person.seatOf ?? agent.name } })
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
    toast(to ? t("start.welcome.sent.to", { name: to, channel: tile.title }) : t("start.welcome.sent.general", { channel: tile.title }))
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
        aria-label={to ? t("start.welcome.note.label", { name: to, channel: tile.title }) : t("start.welcome.note.label.general", { channel: tile.title })}
        placeholder={to ? t("start.welcome.note.placeholder", { name: to }) : t("start.welcome.note.placeholder.general")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <button type="button" className={cx("calm-send", text.trim() && "is-ready")} aria-label={t("start.welcome.send")} title={t("start.welcome.send.title")} disabled={!text.trim()} onClick={send}>
        <Icon name="send" size={14} />
      </button>
    </div>
  )
}
