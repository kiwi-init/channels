import { useEffect, useState } from "react"

import "~/styles/start.css"
import { Dot } from "~/kit/bits"
import { ago } from "~/kit/time"
import type { Channel } from "~/model"
import { useApp } from "~/nav"

function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}

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
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-wait">
        <p className="start-wait-state">
          <Dot status="doing" />
          Asked {since === "now" ? "just now" : `${since} ago`}
        </p>
        <h1 className="start-title">Waiting for the owner of {channel.title} to let you in.</h1>
        <p className="start-sub">Tell them your code. They'll check it matches the one on their screen.</p>
        <p className="start-code" aria-label={`Your code: ${waiting.code.split("").join(" ")}`}>
          {waiting.code}
        </p>
        <button type="button" className="btn is-quiet" onClick={cancel}>
          Cancel request
        </button>
      </div>
    </main>
  )
}
