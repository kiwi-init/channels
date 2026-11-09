import { Suspense, useCallback, useState } from "react"
import { createPortal } from "react-dom"

import { useUpdatesSlot } from "~/chat/updates-slot"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Channel, Message } from "~/model"

const Panel = later(() => import("~/chat/updates-panel").then((m) => m.Panel))

interface Props {
  channel: Channel
  runs: readonly Message[][]
  here: number | null
  jump: number | null
}

export function Updates({ channel, runs, here, jump }: Props) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const target = jump !== null && runs.some((r) => r.some((m) => m.seq === jump)) ? jump : null
  const [opened, setOpened] = useState<number | null>(null)
  if (target !== opened) {
    setOpened(target)
    if (target !== null) setOpen(true)
  }
  const slot = useUpdatesSlot()
  if (!runs.length || !slot) return null
  return createPortal(
    <div className="updates">
      <button
        type="button"
        className={cx("icon-btn", "updates-toggle", open && "is-on")}
        data-updates-toggle
        aria-label={t("chat.events.updates")}
        title={t("chat.events.updates")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Icon name="updates" />
      </button>
      {open && (
        <Suspense fallback={null}>
          <Panel channel={channel} runs={runs} here={here} target={target} onClose={close} />
        </Suspense>
      )}
    </div>,
    slot
  )
}
