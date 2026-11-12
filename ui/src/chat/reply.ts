import { createContext, useContext } from "react"

import type { Message } from "~/model"

export type Quoting = { kind: "message"; to: Message; excerpt: string | null } | { kind: "task"; task: number; excerpt: string }

export interface Replying {
  quoting: Quoting | null
  set: (quoting: Quoting | null) => void
}

export const replyTo = (to: Message, excerpt: string | null = null): Quoting => ({ kind: "message", to, excerpt })

export const ReplyContext = createContext<Replying | null>(null)

export const useReplying = (): Replying | null => useContext(ReplyContext)

export function jumpTo(root: HTMLElement | null, seq: number, motion: "glide" | "instant" = "glide"): boolean {
  const el = root?.querySelector<HTMLElement>(`[data-seq="${seq}"]`)
  if (!el) return false
  const glide = motion === "glide" && !matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ block: "center", behavior: glide ? "smooth" : "auto" })
  flash(el)
  return true
}

export function flash(el: HTMLElement): void {
  el.classList.remove("is-flash")
  void el.offsetWidth
  el.classList.add("is-flash")
  el.addEventListener("animationend", () => el.classList.remove("is-flash"), { once: true })
}

export { preview } from "~/chat/preview"
