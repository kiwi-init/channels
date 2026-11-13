import { fillPane, movePane, splitAt } from "~/panes/ops"
import { MIN_H, MIN_W, setDrag, type Carry, type Drag, type Edge } from "~/panes/store"

const START = 6

export function targetAt(x: number, y: number, carry: Carry): Drag["target"] {
  const pane = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane]")
  const host = pane?.closest<HTMLElement>("[data-panes]")
  if (!pane || !host || ("pane" in carry && pane.dataset.pane === carry.pane)) return null
  const r = pane.getBoundingClientRect()
  if (pane.classList.contains("is-blank")) return { code: host.dataset.panes ?? "", id: pane.dataset.pane ?? "", edge: "right", fill: true, box: { x: r.left, y: r.top, w: r.width, h: r.height } }
  const dx = (x - r.left) / r.width - 0.5
  const dy = (y - r.top) / r.height - 0.5
  const wide = r.width / 2 >= MIN_W
  const tall = r.height / 2 >= MIN_H
  if (!wide && !tall) return null
  const across = Math.abs(dx) >= Math.abs(dy) ? wide : !tall
  const edge: Edge = across ? (dx < 0 ? "left" : "right") : dy < 0 ? "top" : "bottom"
  const box = {
    x: edge === "right" ? r.left + r.width / 2 : r.left,
    y: edge === "bottom" ? r.top + r.height / 2 : r.top,
    w: across ? r.width / 2 : r.width,
    h: across ? r.height : r.height / 2,
  }
  return { code: host.dataset.panes ?? "", id: pane.dataset.pane ?? "", edge, box }
}

export function dropOn(target: NonNullable<Drag["target"]>, carry: Carry): void {
  if (target.fill) fillPane(target.code, target.id, carry)
  else if ("pane" in carry) movePane(target.code, carry.pane, target.id, target.edge)
  else splitAt(target.code, target.id, target.edge, carry.page)
}

function swallowClick(): void {
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener("click", stop, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener("click", stop, true), 0)
}

export function follow(carry: Carry, label: string, from: { x: number; y: number }): void {
  let now: Drag | null = null
  const root = document.documentElement
  const move = (m: PointerEvent) => {
    if (!now && Math.hypot(m.clientX - from.x, m.clientY - from.y) < START) return
    now = { carry, label, x: m.clientX, y: m.clientY, target: targetAt(m.clientX, m.clientY, carry) }
    root.toggleAttribute("data-dragging", true)
    setDrag(now)
  }
  const stop = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
    window.removeEventListener("keydown", key, true)
    root.removeAttribute("data-dragging")
    setDrag(null)
  }
  const up = () => {
    const target = now?.target
    if (now) swallowClick()
    stop()
    if (!target) return
    dropOn(target, carry)
  }
  const cancel = () => stop()
  const key = (k: KeyboardEvent) => {
    if (k.key !== "Escape") return
    k.preventDefault()
    k.stopPropagation()
    if (now) swallowClick()
    stop()
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", cancel)
  window.addEventListener("keydown", key, true)
}
