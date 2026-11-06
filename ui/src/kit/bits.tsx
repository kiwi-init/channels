import { Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react"

import { useMoved } from "~/kit/glide"
import { Icon } from "~/kit/icons"
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

export const STATUS_WORDS: Record<TaskStatus, string> = { todo: "to do", doing: "working", review: "in review", landing: "landing", done: "done", waiting: "needs you" }

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
