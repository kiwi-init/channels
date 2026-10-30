import "~/styles/start.css"
import { Dot } from "~/kit/bits"
import { ago, useNow } from "~/kit/time"
import type { Channel } from "~/model"
import { useApp } from "~/nav"

export function Waiting({ channel }: { channel: Channel }) {
  const { app, go } = useApp()
  const now = useNow(30_000)
  const waiting = channel.waiting
  if (!waiting) return null
  const since = ago(waiting.since, now)
  const cancel = () => {
    app.actions.leaveChannel(channel.code)
    const next = app.channels.find((c) => c.code !== channel.code && c.state === "member")
    go(next ? { to: "channel", code: next.code } : { to: "home" })
  }
  const owner = waiting.owner
  if (waiting.state === "declined")
    return (
      <main className="start-area">
        <div className="start-drag" />
        <div className="start-wait">
          <h1 className="start-title">{owner ?? "The owner"} didn't let you in.</h1>
          <p className="start-sub">Your request to join {channel.title} was declined. Ask for a new invite if that was a mistake.</p>
          <button type="button" className="btn" onClick={cancel}>
            Back to channels
          </button>
        </div>
      </main>
    )
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-wait">
        <p className="start-wait-state">
          <Dot status="doing" />
          Asked {since === "now" ? "just now" : `${since} ago`}
        </p>
        <h1 className="start-title">{owner ? `Waiting for ${owner} to let you in.` : `Waiting for the owner of ${channel.title} to let you in.`}</h1>
        {waiting.state === "unreachable" && <p className="start-hint is-error">Can't reach the relay right now. Still trying…</p>}
        {waiting.code ? (
          <>
            <p className="start-sub">Tell them your code. They'll check it matches the one on their screen.</p>
            <p className="start-code" aria-label={`Your code: ${waiting.code.split("").join(" ")}`}>
              {waiting.code}
            </p>
          </>
        ) : (
          <p className="start-sub">Your code shows here once {owner ?? "the owner"} opens your request. Then read it to them: they check it matches the one on their screen.</p>
        )}
        <button type="button" className="btn is-quiet" onClick={cancel}>
          Cancel request
        </button>
      </div>
    </main>
  )
}
