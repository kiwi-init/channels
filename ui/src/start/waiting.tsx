import "~/i18n/en/shell-later"
import "~/styles/start.css"
import { Dot } from "~/kit/bits"
import { ageOf, ago, useNow } from "~/kit/time"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { t } from "~/i18n/i18n"

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
          <h1 className="start-title">{owner ? t("start.waiting.declined.named", { owner }) : t("start.waiting.declined")}</h1>
          <p className="start-sub">{t("start.waiting.declined.sub", { name: channel.title })}</p>
          <button type="button" className="btn" onClick={cancel}>
            {t("start.waiting.back")}
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
          {ageOf(waiting.since, now) === "now" ? t("start.waiting.asked.now") : t("start.waiting.asked.ago", { since })}
        </p>
        <h1 className="start-title">{owner ? t("start.waiting.for.named", { owner }) : t("start.waiting.for.owner", { name: channel.title })}</h1>
        {waiting.state === "unreachable" && <p className="start-hint is-error">{t("start.waiting.unreachable")}</p>}
        {waiting.code ? (
          <>
            <p className="start-sub">{t("start.waiting.tell.code")}</p>
            <p className="start-code" aria-label={t("start.waiting.your.code", { code: waiting.code.split("").join(" ") })}>
              {waiting.code}
            </p>
          </>
        ) : (
          <p className="start-sub">{owner ? t("start.waiting.code.soon.named", { owner }) : t("start.waiting.code.soon")}</p>
        )}
        <button type="button" className="btn is-quiet" onClick={cancel}>
          {t("start.waiting.cancel")}
        </button>
      </div>
    </main>
  )
}
