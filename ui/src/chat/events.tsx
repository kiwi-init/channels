import { Suspense, useCallback, useState } from "react"

import { useActivity } from "~/chat/activity"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Channel } from "~/model"

const Panel = later(() => import("~/chat/updates-panel").then((m) => m.Panel))

export function ActivityButton({ channel }: { channel: Channel }) {
  const activity = useActivity()
  const target = activity?.target ?? null
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const [opened, setOpened] = useState<number | null>(null)
  if (target !== opened) {
    setOpened(target)
    if (target !== null) setOpen(true)
  }
  if (!activity) return null
  return (
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
          <Panel channel={channel} runs={activity.runs} here={activity.here} target={target} onClose={close} />
        </Suspense>
      )}
    </div>
  )
}
