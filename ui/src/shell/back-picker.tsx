import "~/i18n/en/shell-later"
import "~/styles/back-picker.css"

import { useCallback, useEffect, useState } from "react"

import type { UpChoices, UpOutcome, UpPick } from "@kiwi/core/up-outcome.ts"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { Modal } from "~/kit/modal"
import { copyText } from "~/kit/toasts"
import { useActions, useGo, useToast } from "~/nav"
import { backToast } from "~/shell/back-card"

export type PickerLoad = { at: "loading" } | { at: "failed"; why: string } | { at: "ready"; choices: UpChoices }

export const seatKey = (s: UpPick): string => `${s.channel}/${s.handle}`

export function byChannel(seats: readonly UpOutcome[]): [string, UpOutcome[]][] {
  const groups = new Map<string, UpOutcome[]>()
  for (const s of seats) groups.set(s.channel, [...(groups.get(s.channel) ?? []), s])
  return [...groups]
}

export function checkedSeats(seats: readonly UpOutcome[], off: ReadonlySet<string>): UpOutcome[] {
  return seats.filter((s) => s.result === "planned" && !off.has(seatKey(s)))
}

export const picksOf = (seats: readonly UpOutcome[]): UpPick[] => seats.map((s) => ({ channel: s.channel, handle: s.handle }))

function SeatRow({ seat, off, onToggle }: { seat: UpOutcome; off: ReadonlySet<string>; onToggle: (key: string, on: boolean) => void }) {
  const key = seatKey(seat)
  if (seat.result !== "planned")
    return (
      <div className="back-seat is-still" title={seat.why}>
        <span className="back-seat-name">{seat.handle}</span>
        <span className={cx("back-seat-state", seat.result === "running" && "tone-live")}>{t(seat.result === "running" ? "shell.back.pick.running" : "shell.back.pick.skipped")}</span>
      </div>
    )
  const on = !off.has(key)
  return (
    <label className={cx("back-seat", on && "is-on")} title={seat.folder}>
      <input type="checkbox" checked={on} onChange={(e) => onToggle(key, e.target.checked)} />
      <span className="back-seat-name">{seat.handle}</span>
      <span className="back-seat-folder">{seat.folder}</span>
    </label>
  )
}

export function PickerBody({
  load,
  off,
  onToggle,
  onRetry,
  onCopy,
}: {
  load: PickerLoad
  off: ReadonlySet<string>
  onToggle: (key: string, on: boolean) => void
  onRetry: () => void
  onCopy: (line: string) => void
}) {
  if (load.at === "loading") return <p className="back-hint">{t("shell.back.pick.loading")}</p>
  if (load.at === "failed")
    return (
      <div className="back-failed" role="alert">
        <p className="back-hint is-error">{t("shell.back.pick.failed", { why: load.why })}</p>
        <button type="button" className="btn is-small" onClick={onRetry}>
          {t("shell.back.pick.retry")}
        </button>
      </div>
    )
  const { seats, tmux } = load.choices
  if (!seats.length) return <p className="back-hint">{t("shell.back.pick.empty")}</p>
  const lines = tmux ? [] : checkedSeats(seats, off)
  return (
    <div className="back-pick">
      {!tmux && (
        <p className="back-no-tmux" role="note">
          {t("shell.back.pick.no.tmux")}
        </p>
      )}
      {byChannel(seats).map(([channel, list]) => (
        <fieldset key={channel} className="back-group">
          <legend>{channel}</legend>
          {list.map((seat) => (
            <SeatRow key={seatKey(seat)} seat={seat} off={off} onToggle={onToggle} />
          ))}
        </fieldset>
      ))}
      {lines.length > 0 && (
        <div className="back-lines">
          {lines.map((s) => (
            <div key={seatKey(s)} className="codebox">
              <code>{s.why}</code>
              <button type="button" className="icon-btn" aria-label={t("shell.back.pick.copy")} title={t("shell.back.pick.copy")} onClick={() => onCopy(s.why)}>
                <Icon name="copy" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BringBackDialog() {
  const go = useGo()
  return <BackPicker onClose={() => go({ to: "dialog", dialog: null })} />
}

function BackPicker({ onClose }: { onClose: () => void }) {
  const actions = useActions()
  const toast = useToast()
  const [load, setLoad] = useState<PickerLoad>({ at: "loading" })
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const fetchChoices = useCallback(
    () =>
      actions.backChoices().then(
        (choices) => setLoad({ at: "ready", choices }),
        (err: unknown) => setLoad({ at: "failed", why: err instanceof Error ? err.message : String(err) })
      ),
    [actions]
  )
  useEffect(() => void fetchChoices(), [fetchChoices])
  const read = () => {
    setLoad({ at: "loading" })
    void fetchChoices()
  }
  const toggle = (key: string, on: boolean) =>
    setOff((was) => {
      const next = new Set(was)
      if (on) next.delete(key)
      else next.add(key)
      return next
    })
  const ready = load.at === "ready" ? load.choices : null
  const tmux = ready?.tmux ?? true
  const picks = ready ? picksOf(checkedSeats(ready.seats, off)) : []
  const start = () => {
    if (!picks.length || busy || !tmux) return
    setBusy(true)
    actions.bringPickedBack(picks).then(
      (run) => {
        const say = backToast(run)
        if (say) toast(say.text, say.tone)
        onClose()
      },
      () => {
        toast(t("shell.updates.back.no.answer"), "error")
        setBusy(false)
      }
    )
  }
  return (
    <Modal onClose={onClose} stays={!tmux} label={t("shell.back.pick.title")} title={t("shell.back.pick.title")} sub={t("shell.back.pick.tmux")}>
      <div className="back-form">
        <PickerBody load={load} off={off} onToggle={toggle} onRetry={read} onCopy={(line) => void copyText(line, t("shell.back.pick.copied"))} />
        <div className="modal-foot">
          {ready && tmux && ready.seats.some((s) => s.result === "planned") && !picks.length && <span className="back-hint">{t("shell.back.pick.none")}</span>}
          <button type="button" className="btn is-quiet" onClick={onClose}>
            {tmux ? t("kit.context.menu.cancel") : t("shell.back.pick.close")}
          </button>
          {tmux && (
            <button type="button" className="btn is-primary" disabled={!picks.length || busy} onClick={start}>
              {busy ? t("shell.updates.back.busy") : t("shell.back.pick.start", { count: picks.length })}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
