import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { useMoved } from "~/kit/glide"
import { Icon, type IconName } from "~/kit/icons"
import { later } from "~/kit/later"
import { useMood, type MoodOf } from "~/kit/mood"
import type { Person, TaskStatus } from "~/model"

export const autofocus = (el: HTMLElement | null) => el?.setAttribute("autofocus", "")

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ")

const RoleFace = later(() => import("~/kit/role-face").then((m) => m.RoleFace))

export function Avatar({
  person,
  size = "md",
  pip,
}: {
  person: (Pick<Person, "name" | "kind" | "harness" | "presence" | "color" | "picture" | "face"> & MoodOf) | undefined
  size?: "sm" | "md" | "lg"
  pip?: boolean
}) {
  const mood = useMood(person?.kind === "agent" ? person : undefined)
  if (!person) return <span className={cx("av", `av-${size}`, "av-gone")} aria-hidden="true" />
  const face = (
    <span
      className={cx("av", `av-${size}`, person.kind === "agent" ? "av-face" : "av-human", person.presence === "offline" && "is-off")}
      data-color={person.color ?? undefined}
      data-harness={person.kind === "agent" ? person.harness : undefined}
      style={person.color ? ({ "--member": `var(--c-${person.color})`, ...(person.kind === "agent" ? { color: `var(--c-${person.color})` } : {}) } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {person.kind === "agent" ? (
        <Suspense fallback={null}>
          <RoleFace role={person.face} harness={person.harness} mood={mood} />
        </Suspense>
      ) : person.picture ? (
        <img src={person.picture} alt="" />
      ) : (
        person.name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
  if (!pip || person.kind === "agent") return face
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

type ModalSize = "narrow" | "wide"

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export type ModalDismiss = "x" | "outside"

export function Modal({
  open = true,
  onClose,
  dismiss,
  label,
  title,
  sub,
  lead,
  tabs,
  foot,
  size,
  className,
  children,
}: {
  open?: boolean
  onClose: () => void
  dismiss: ModalDismiss
  label: string
  title: ReactNode
  sub?: ReactNode
  lead?: ReactNode
  tabs?: ReactNode
  foot?: ReactNode
  size?: ModalSize
  className?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const wanted = useRef(open)
  const pressed = useRef<EventTarget | null>(null)
  useEffect(() => {
    wanted.current = open
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      ;(el.querySelector<HTMLElement>("[autofocus]") ?? el).focus()
    }
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className={cx("modal", size && `is-${size}`, !!tabs && "has-tabs", !children && "is-bare")}
      aria-label={label}
      onClose={() => {
        if (wanted.current) onClose()
      }}
      onPointerDown={(e) => {
        pressed.current = e.target
      }}
      onClick={(e) => {
        const started = pressed.current
        pressed.current = null
        if (dismiss === "outside" && e.target === e.currentTarget && started === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab" || e.defaultPrevented) return
        const stops = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (!stops.length) return
        e.preventDefault()
        const at = stops.indexOf(document.activeElement as HTMLElement)
        const next = at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length
        stops[next]?.focus()
      }}
    >
      {open && (
        <>
          <header className={cx("modal-head", !!lead && "has-lead")}>
            {lead && <span className="modal-lead">{lead}</span>}
            <div className="modal-title">
              <h2>{title}</h2>
              {sub && <p>{sub}</p>}
            </div>
            <IconButton icon="close" label="Close" onClick={onClose} />
            {tabs && <div className="modal-tabs">{tabs}</div>}
          </header>
          {children && <div className={cx("modal-body", className)}>{children}</div>}
          {foot && <footer className="modal-foot">{foot}</footer>}
        </>
      )}
    </dialog>
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

export function Toggle({ on, onChange, label, id, disabled }: { on: boolean; onChange?: (on: boolean) => void; label?: string; id?: string; disabled?: boolean }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cx("toggle", on && "is-on")} onClick={() => onChange?.(!on)}>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </button>
  )
}
