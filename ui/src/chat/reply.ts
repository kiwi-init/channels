import { createContext, useContext } from "react"

import type { Message } from "~/model"

export interface Replying {
  to: Message | null
  set: (m: Message | null) => void
}

export const ReplyContext = createContext<Replying | null>(null)

export const useReplying = (): Replying | null => useContext(ReplyContext)

export function jumpTo(root: HTMLElement | null, seq: number): boolean {
  const el = root?.querySelector<HTMLElement>(`[data-seq="${seq}"]`)
  if (!el) return false
  el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  el.classList.remove("is-flash")
  void el.offsetWidth
  el.classList.add("is-flash")
  el.addEventListener("animationend", () => el.classList.remove("is-flash"), { once: true })
  return true
}

export { preview } from "~/chat/preview"
