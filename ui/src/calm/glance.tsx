import { useNow } from "~/kit/time"
import { useApp } from "~/nav"
import { ChannelPart, Waiting } from "~/start/welcome"

const CHANNELS = 4
const AGENTS = 3

export function Glance() {
  const { app } = useApp()
  const now = useNow(60_000)
  const byCode = new Map(app.home.map((h) => [h.code, h]))
  const tiles = app.channels.filter((t) => t.state === "member")
  return (
    <div className="rest-card calm" data-afk-keep>
      <Waiting tiles={tiles} home={app.home} most={1} now={now} loud />
      {tiles.slice(0, CHANNELS).map((t) => (
        <ChannelPart key={t.code} tile={t} summary={byCode.get(t.code)} now={now} most={AGENTS} />
      ))}
    </div>
  )
}
