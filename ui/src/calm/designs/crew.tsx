import { Answer, useAway, type AgentAt } from "~/calm/designs/shared"
import { Avatar, Count, cx, Dot } from "~/kit/bits"
import { ago, useNow } from "~/kit/time"

const ASKS_SHOWN = 3

function Member({ a, now, open }: { a: AgentAt; now: number; open: (code: string) => void }) {
  const state = a.agent.state
  return (
    <li>
      <button type="button" className={cx("afk-member", `is-${state}`)} data-afk-keep="" onClick={() => open(a.tile.code)}>
        <Avatar person={a.person} size="lg" />
        <span className="afk-member-name">
          {state === "working" && <Dot status="doing" />}
          {a.agent.nick}
        </span>
        <span className="afk-member-task">{a.agent.task ? a.agent.task.title : state === "waiting" ? "Waiting on you" : state === "working" ? a.agent.doing : "Free"}</span>
        <span className="afk-member-doing mono">
          {[a.agent.task ? `T${a.agent.task.id}` : null, a.agent.task || state !== "working" ? a.agent.doing : null, a.agent.since ? ago(a.agent.since, now) : null].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  )
}

export function Crew({ open }: { open: (code: string) => void }) {
  const away = useAway()
  const now = useNow(30_000)
  const shown = away.asks.slice(0, ASKS_SHOWN)
  return (
    <>
      {shown.length > 0 && (
        <section className="afk-crew-asks afk-float" aria-label="Waiting on you">
          <h3 className="afk-head">
            Waiting on you <Count n={away.asks.length} loud />
          </h3>
          <ol>
            {shown.map((at) => (
              <li key={`${at.tile.code}:${at.ask.id}`}>
                <p className="afk-ask-text">
                  <b>{at.ask.what}</b> · <span className="afk-meta mono">{ago(at.ask.at, now)}</span>
                </p>
                <p className="afk-ask-body">{at.ask.text}</p>
                <Answer at={at} onOpen={open} />
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="afk-crew afk-float" aria-label="The crew">
        {away.pairs.map((p) => {
          const members = away.agents.filter((a) => a.tile.code === p.tile.code && a.agent.state !== "away")
          if (!members.length) return null
          return (
            <div key={p.tile.code} className="afk-crew-group">
              <h3 className="afk-head">
                {p.tile.title}
                <span className="afk-meta mono">
                  {p.home.working} working{p.home.doneToday ? ` · ${p.home.doneToday} done today` : ""}
                </span>
              </h3>
              <ul className="afk-crew-row">
                {members.map((a) => (
                  <Member key={a.agent.name} a={a} now={now} open={open} />
                ))}
              </ul>
            </div>
          )
        })}
      </section>
    </>
  )
}
