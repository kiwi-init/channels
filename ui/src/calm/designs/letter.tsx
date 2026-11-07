import type { ReactNode } from "react"

import { Answer, plural, Reply, useAway, type Pair } from "~/calm/designs/shared"
import { ago, clock, useNow } from "~/kit/time"

const NAMED = 3
const ASKS_SHOWN = 3
const TITLE_CLIP = 56

function clip(text: string): string {
  return text.length <= TITLE_CLIP ? text : `${text.slice(0, TITLE_CLIP - 1).trimEnd()}…`
}

function story(p: Pair, open: (code: string) => void): ReactNode {
  const working = p.home.agents.filter((a) => a.state === "working")
  const waiting = p.home.agents.filter((a) => a.state === "waiting")
  const name = (
    <button type="button" className="afk-link" data-afk-keep="" onClick={() => open(p.tile.code)}>
      {p.tile.title}
    </button>
  )
  if (!working.length && !waiting.length && !p.home.doneToday) {
    return (
      <>
        {name} is quiet.
        {p.home.said && (
          <>
            {" "}
            The last word was {p.home.said.from}’s: “{clip(p.home.said.text)}”
          </>
        )}
      </>
    )
  }
  const named = working.slice(0, NAMED)
  const rest = working.length - named.length
  return (
    <>
      In {name}, {plural(working.length, "agent is", "agents are")} working.{" "}
      {named.map((a, i) => (
        <span key={a.name}>
          <b>{a.nick}</b>{" "}
          {a.task ? (
            <>
              is on <span className="mono">T{a.task.id}</span> {clip(a.task.title)}
            </>
          ) : (
            <>is {a.doing}</>
          )}
          {i < named.length - 1 ? (i === named.length - 2 && !rest ? ", and " : ", ") : rest ? `, and ${plural(rest, "other", "others")} too. ` : ". "}
        </span>
      ))}
      {waiting.length > 0 && (
        <>
          {waiting.map((a) => a.nick).join(" and ")} {waiting.length === 1 ? "is" : "are"} waiting on you.{" "}
        </>
      )}
      {p.home.doneToday > 0 && <>{plural(p.home.doneToday, "task", "tasks")} landed today. </>}
      {p.home.red > 0 && <span className="tone-alert">{plural(p.home.red, "check is", "checks are")} red.</span>}
    </>
  )
}

export function Letter({ open, since }: { open: (code: string) => void; since: number }) {
  const away = useAway()
  const now = useNow(60_000)
  const lead = away.pairs[0]
  if (!lead) return null
  return (
    <article className="afk-letter afk-float" aria-label="While you were away">
      <p className="afk-stamp mono">
        {clock(since)} – {clock(now)}
      </p>
      <h2 className="afk-letter-title">While you were away</h2>
      {away.pairs.map((p) => (
        <p key={p.tile.code} className="afk-letter-p">
          {story(p, open)}
        </p>
      ))}
      {away.asks.length > 0 && (
        <>
          <h3 className="afk-head">
            Waiting on you <span className="num">{away.asks.length}</span>
          </h3>
          <ol className="afk-letter-asks">
            {away.asks.slice(0, ASKS_SHOWN).map((at) => (
              <li key={`${at.tile.code}:${at.ask.id}`}>
                <p className="afk-ask-text">
                  <b>{at.ask.what}</b>: {at.ask.text}
                </p>
                <div className="afk-ask-foot">
                  <span className="afk-meta mono">
                    {at.tile.title} · {ago(at.ask.at, now)}
                  </span>
                  <Answer at={at} onOpen={open} />
                </div>
              </li>
            ))}
          </ol>
          {away.asks.length > ASKS_SHOWN && <p className="afk-more">{plural(away.asks.length - ASKS_SHOWN, "more waits", "more wait")} in Needs you.</p>}
        </>
      )}
      <p className="afk-sign">{lead.home.leadName ? `${lead.home.leadName}, lead of ${lead.tile.title}` : lead.tile.title}</p>
      <Reply pair={lead} />
    </article>
  )
}
