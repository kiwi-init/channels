import "~/i18n/en/chat-later"
import { useEffect, useRef } from "react"

import { t } from "~/i18n/i18n"
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
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      onClose()
    }
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || box.current?.contains(e.target) || e.target.closest("[data-updates-toggle]")) return
      onClose()
    }
    document.addEventListener("keydown", esc, true)
    document.addEventListener("pointerdown", outside, true)
    return () => {
      document.removeEventListener("keydown", esc, true)
      document.removeEventListener("pointerdown", outside, true)
    }
  }, [onClose])
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
