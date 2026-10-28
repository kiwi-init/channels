import { useEffect, useRef, useState } from "react"

import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useApp } from "~/nav"

export function UpdateDock() {
  const { app } = useApp()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const look = app.account?.uiUpdate
  const update = app.account?.update
  const state = update?.state ?? (update?.ready ? "ready" : "downloading")

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [open])

  if (!look && !update) return null
  const ready = !!look || state === "ready"
  const label =
    look && update
      ? "Updates ready"
      : look
        ? "UI changes are ready"
        : state === "ready"
          ? `Channels ${update?.version} is ready`
          : state === "available"
            ? `Channels ${update?.version} is out`
            : `Channels ${update?.version} is downloading`

  return (
    <div className="dock" ref={box}>
      <button type="button" className={cx("dock-btn", ready && "is-ready")} aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={look ? "sparkle" : "download"} />
      </button>
      {open && (
        <div className="dock-card" role="dialog" aria-label="Updates">
          {look && (
            <section className="dock-part">
              <p className="dock-title">
                <Icon name="sparkle" size={14} />
                UI changes are ready
              </p>
              <p className="dock-text">Channels has a new look waiting. Nothing changes until you accept it; it also starts with the next launch.</p>
              <div className="actions">
                <button
                  type="button"
                  className="btn is-primary is-small"
                  onClick={() => {
                    setOpen(false)
                    app.actions.applyUi()
                  }}
                >
                  Accept changes
                </button>
                <button type="button" className="btn is-quiet is-small" onClick={() => setOpen(false)}>
                  Later
                </button>
              </div>
            </section>
          )}
          {update && (
            <section className="dock-part">
              <p className="dock-title">
                <Icon name="download" size={14} />
                Channels {update.version}
              </p>
              <p className="dock-text">
                {state === "ready"
                  ? "Downloaded. Channels restarts into it when you're ready; your work stays where it is."
                  : state === "downloading"
                    ? "Downloading in the background. You'll restart into it when it's done."
                    : "A new version is out. Download it and restart."}
              </p>
              {state !== "downloading" && (
                <div className="actions">
                  <button
                    type="button"
                    className="btn is-primary is-small"
                    onClick={() => {
                      setOpen(false)
                      app.actions.installUpdate()
                    }}
                  >
                    {state === "ready" ? "Restart to update" : "Download and restart"}
                  </button>
                  <button type="button" className="btn is-quiet is-small" onClick={() => setOpen(false)}>
                    Later
                  </button>
                </div>
              )}
              {state === "downloading" && (
                <p className="dock-wait">
                  <span className="dot is-doing" aria-hidden="true" />
                  Downloading…
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
