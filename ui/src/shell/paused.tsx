import { Icon } from "~/kit/icons"
import { useNow } from "~/kit/time"
import { useApp } from "~/nav"

export default function Paused() {
  const { app, go } = useApp()
  const until = app.prefs.snoozeUntil
  const now = useNow(60_000)
  const label = until !== null && until > now ? `Notifications paused until ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Quiet hours: notifications paused"
  return (
    <button type="button" className="rail-gear is-quiet" aria-label={label} title={label} onClick={() => go({ to: "settings", section: "notifications" })}>
      <Icon name="moon" size={16} />
    </button>
  )
}
