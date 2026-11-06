import type { ReactNode } from "react"

import { cx } from "~/kit/bits"

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Toggle({ on, onChange, label, id, disabled }: { on: boolean; onChange?: (on: boolean) => void; label?: string; id?: string; disabled?: boolean }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cx("toggle", on && "is-on")} onClick={() => onChange?.(!on)}>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </button>
  )
}
