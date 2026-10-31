import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { useMoved } from "~/kit/glide"
import { Icon, type IconName } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Person, TaskStatus } from "~/model"

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ")

const RoleFace = later(() => import("~/kit/role-face").then((m) => m.RoleFace))

export function Avatar({
  person,
  size = "md",
  pip,
}: {
  person: Pick<Person, "name" | "kind" | "harness" | "presence" | "color" | "picture" | "face"> | undefined
  size?: "sm" | "md" | "lg"
  pip?: boolean
}) {
  if (!person) return <span className={cx("av", `av-${size}`, "av-gone")} aria-hidden="true" />
  const face = (
    <span
      className={cx("av", `av-${size}`, person.kind === "agent" ? "av-face" : "av-human", person.presence === "offline" && "is-off")}
      data-color={person.kind === "human" && person.color ? person.color : undefined}
      data-harness={person.kind === "agent" ? person.harness : undefined}
      style={person.kind === "human" && person.color ? ({ "--member": `var(--c-${person.color})` } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {person.kind === "agent" ? (
        <Suspense fallback={null}>
          <RoleFace role={person.face} harness={person.harness} />
        </Suspense>
      ) : person.picture ? (
        <img src={person.picture} alt="" />
      ) : (
        person.name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
  if (!pip) return face
  return (
    <span className="av-wrap" aria-hidden="true">
      {face}
      <span className={cx("pip", `is-${person.presence}`)} />
    </span>
  )
}

export const STATUS_WORDS: Record<TaskStatus, string> = { todo: "to do", doing: "working", review: "in review", done: "done", waiting: "needs you" }

export const statusWord = (t: { status: TaskStatus; cancelled?: boolean }): string => (t.cancelled ? "cancelled" : STATUS_WORDS[t.status])

export function Dot({ status }: { status: TaskStatus }) {
  const moved = useMoved(status)
  return <span key={status} className={cx("dot", `is-${status}`, moved && "is-moved")} aria-hidden="true" />
}

export function Count({ n, loud }: { n: number; loud?: boolean }) {
  const moved = useMoved(n)
  if (!n) return null
  return (
    <span className={cx("count", loud && "is-loud")}>
      <span key={n} className={moved ? "count-n" : undefined}>
        {n > 99 ? "99+" : n}
      </span>
    </span>
  )
}

export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="heading">
      <h3>{children}</h3>
      {action}
    </div>
  )
}

export function IconButton({ icon, label, onClick, pressed }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

export function Dialog({ open, onClose, label, children, wide }: { open: boolean; onClose: () => void; label: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const wanted = useRef(open)
  useEffect(() => {
    wanted.current = open
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      el.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")?.focus()
    }
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      className={cx("dialog", wide && "is-wide")}
      aria-label={label}
      onClose={() => {
        if (wanted.current) onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {open && <div className="dialog-body">{children}</div>}
    </dialog>
  )
}

export function DialogHead({ title, onClose, sub }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <header className="dialog-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="dim">{sub}</p>}
      </div>
      <IconButton icon="close" label="Close" onClick={onClose} />
    </header>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Empty({ title, icon, children }: { title: string; icon?: IconName; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} size={20} />
        </span>
      )}
      <p className="empty-title">{title}</p>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}

export function useLate(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) return
    const timer = window.setTimeout(() => setLate(true), ms)
    return () => {
      window.clearTimeout(timer)
      setLate(false)
    }
  }, [on, ms])
  return on && late
}

export function Loading() {
  const late = useLate(true, 400)
  return (
    <div className="empty" role="status">
      {late && <p className="empty-text">Loading…</p>}
    </div>
  )
}

export function Toggle({ on, onChange, label, id }: { on: boolean; onChange: (on: boolean) => void; label?: string; id?: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={on} aria-label={label} className={cx("toggle", on && "is-on")} onClick={() => onChange(!on)}>
      <span className="toggle-word" aria-hidden="true">
        {on ? "On" : "Off"}
      </span>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </button>
  )
}
