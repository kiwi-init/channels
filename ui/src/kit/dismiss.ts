import { useEffect, useEffectEvent, type RefObject } from "react"

type Ignore = { box: RefObject<Element | null>; toggle: string } | ((target: EventTarget | null) => boolean | undefined)

export interface Dismiss {
  on: "document" | "window"
  keys: "capture" | "bubble"
  escape: "stop" | "pass"
  ignore: Ignore
  when?: boolean
}

interface Host {
  addEventListener(type: "keydown", fn: (e: KeyboardEvent) => void, capture: boolean): void
  addEventListener(type: "pointerdown", fn: (e: PointerEvent) => void, capture: boolean): void
  removeEventListener(type: "keydown", fn: (e: KeyboardEvent) => void, capture: boolean): void
  removeEventListener(type: "pointerdown", fn: (e: PointerEvent) => void, capture: boolean): void
}

const ignores = (ignore: Ignore, target: EventTarget | null): boolean | undefined =>
  typeof ignore === "function" ? ignore(target) : !(target instanceof Element) || !!ignore.box.current?.contains(target) || !!target.closest(ignore.toggle)

export function useDismiss(onClose: () => void, { on, keys, escape, ignore, when = true }: Dismiss): void {
  const close = useEffectEvent(onClose)
  const ignored = useEffectEvent((target: EventTarget | null) => ignores(ignore, target))
  useEffect(() => {
    if (!when) return
    const at: Host = on === "window" ? window : document
    const capture = keys === "capture"
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (escape === "stop") e.stopPropagation()
      close()
    }
    const outside = (e: PointerEvent) => {
      if (!ignored(e.target)) close()
    }
    at.addEventListener("keydown", esc, capture)
    at.addEventListener("pointerdown", outside, true)
    return () => {
      at.removeEventListener("keydown", esc, capture)
      at.removeEventListener("pointerdown", outside, true)
    }
  }, [on, keys, escape, when])
}
