import "~/i18n/en/chat-later"
import { useRef } from "react"

import { t } from "~/i18n/i18n"
import { useDismiss } from "~/kit/dismiss"
import type { Channel, Message } from "~/model"
import { ActivityText } from "~/panes/activity"

interface Shown {
  channel: Channel
  runs: readonly Message[][]
  here: number | null
  target: number | null
}

export function Panel({ onClose, ...shown }: Shown & { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useDismiss(onClose, { on: "document", keys: "capture", escape: "stop", ignore: { box, toggle: "[data-updates-toggle]" } })
  return (
    <div ref={box} role="dialog" aria-label={t("chat.updates.panel.label")} className="updates-panel">
      <Log {...shown} />
    </div>
  )
}

export function Log({ channel, runs, target }: Shown) {
  return (
    <div className="updates-log">
      <ActivityText channel={channel} runs={runs} target={target} />
    </div>
  )
}
