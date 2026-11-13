import "~/i18n/en/shell-later"
import { Suspense, useLayoutEffect } from "react"

import { t } from "~/i18n/i18n"
import { Boundary } from "~/kit/boundary"
import { later } from "~/kit/later"
import type { Channel } from "~/model"
import { useNav } from "~/nav"
import { usePanelWidth } from "~/shell/panel-width"

const PrPanel = later(() => import("~/github/panel").then((m) => m.PrPanel))
const IssuePanel = later(() => import("~/github/panel").then((m) => m.IssuePanel))
const TaskPanel = later(() => import("~/panels/task").then((m) => m.TaskPanel))
const ThreadPanel = later(() => import("~/panels/thread").then((m) => m.ThreadPanel))

export function NarrowPanel({ channel, hidden }: { channel: Channel; hidden: boolean }) {
  const panel = usePanelWidth(hidden)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--panel-w", `${panel.width}px`)
    return () => void root.style.removeProperty("--panel-w")
  }, [panel.width])
  return (
    <aside className="panel" aria-label={t("shell.channel.details")}>
      <div
        className="panel-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("shell.channel.resize")}
        aria-valuemin={panel.min}
        aria-valuemax={panel.max}
        aria-valuenow={panel.width}
        tabIndex={0}
        title={t("shell.channel.resize.title")}
        {...panel.grip}
      />
      <PanelView channel={channel} />
    </aside>
  )
}

function PanelView({ channel }: { channel: Channel }) {
  const nav = useNav()
  if (!nav.panel) return null
  return (
    <Boundary panel resetKey={JSON.stringify(nav.panel)}>
      <Suspense fallback={null}>
        {nav.panel.kind === "thread" ? (
          <ThreadPanel channel={channel} seq={nav.panel.seq} focus={nav.panel.focus} />
        ) : nav.panel.kind === "task" ? (
          <TaskPanel channel={channel} id={nav.panel.task} />
        ) : nav.panel.kind === "pr" ? (
          <PrPanel channel={channel} repo={nav.panel.repo} number={nav.panel.number} />
        ) : (
          <IssuePanel channel={channel} repo={nav.panel.repo} number={nav.panel.number} />
        )}
      </Suspense>
    </Boundary>
  )
}
