import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useApp } from "~/nav"

export function UpdateDock() {
  const { app } = useApp()
  const look = app.account?.uiUpdate
  const update = app.account?.update
  const state = update?.state ?? (update?.ready ? "ready" : "downloading")

  if (!look && !update) return null
  const ready = !!look || state === "ready"
  const label = look
    ? "Switch to the new look"
    : state === "ready"
      ? `Restart into Channels ${update?.version}`
      : state === "available"
        ? `Download Channels ${update?.version} and restart`
        : `Channels ${update?.version} is downloading. Click to restart when it's in`

  return (
    <div className="dock">
      <button type="button" className={cx("dock-btn", ready && "is-ready")} aria-label={label} title={label} onClick={() => (look ? app.actions.applyUi() : app.actions.installUpdate())}>
        <Icon name={look ? "sparkle" : "download"} />
      </button>
    </div>
  )
}
