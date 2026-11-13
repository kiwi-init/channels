import "~/i18n/en/shell-later"
import "~/styles/start.css"
import { Link01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"

import { GlyphIcon, Icon } from "~/kit/icons"
import { useApp, useGo } from "~/nav"
import { onboarded } from "~/start/onboarded"
import { Onboarding } from "~/start/onboarding"
import { t } from "~/i18n/i18n"

export function Welcome() {
  const { app } = useApp()
  const go = useGo()
  const first = app.channels.find((c) => c.state !== "gone")?.code
  useEffect(() => {
    if (first) go({ to: "channel", code: first })
  }, [first, go])
  return first ? null : <Empty />
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
        {!quiet && <GlyphIcon glyph={Link01Icon} size={14} />}
        {t("start.welcome.join")}
      </button>
    </>
  )
}
