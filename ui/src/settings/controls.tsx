import "~/styles/settings.css"

import { useState, type ReactNode } from "react"

import { cx, Dialog, DialogHead } from "~/kit/bits"
import { Track } from "~/kit/glide"

export function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return (
    <Track className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </Track>
  )
}

export function Row({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("set-row", wide && "is-wide")}>
      <div className="set-row-text">
        <span className="set-row-label">{label}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </div>
      {children && <div className="set-row-ctl">{children}</div>}
    </div>
  )
}

export function Group({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="set-group" aria-label={title}>
      {title && (
        <div className="heading">
          <h3>{title}</h3>
        </div>
      )}
      {hint && <p className="set-group-hint">{hint}</p>}
      <div className="set-rows">{children}</div>
    </section>
  )
}

export function InlineEdit({ value, label, verb, onSave }: { value: string; label: string; verb: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null)
    return (
      <span className="set-inline">
        <span className="set-inline-value">{value}</span>
        <button type="button" className="btn is-quiet is-small" onClick={() => setDraft(value)}>
          {verb}
        </button>
      </span>
    )
  return (
    <form
      className="set-inline"
      onSubmit={(e) => {
        e.preventDefault()
        const next = draft.trim()
        if (next && next !== value) onSave(next)
        setDraft(null)
      }}
    >
      <input
        autoFocus
        className="input is-mono set-inline-input"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          e.stopPropagation()
          setDraft(null)
        }}
      />
      <button type="submit" className="btn is-small" disabled={!draft.trim()}>
        Save
      </button>
      <button type="button" className="btn is-quiet is-small" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
  )
}

export function Confirm({
  open,
  title,
  sub,
  action,
  ready = true,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean
  title: string
  sub: string
  action: string
  ready?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <DialogHead title={title} sub={sub} onClose={onClose} />
      <form
        className="set-confirm"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onConfirm()
        }}
      >
        {children}
        <div className="dialog-foot">
          <button type="button" className="btn is-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn is-danger" disabled={!ready} autoFocus={!children}>
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
