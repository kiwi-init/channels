import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from "react"

import { useSideways } from "~/kit/sideways"

const ON = "data-glide-on"

function offset(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  let at: HTMLElement | null = el
  while (at && at !== root) {
    x += at.offsetLeft
    y += at.offsetTop
    at = at.offsetParent as HTMLElement | null
  }
  return { x, y }
}

function place(root: HTMLElement, selector: string): void {
  const on = root.querySelector<HTMLElement>(selector)
  const was = root.querySelector<HTMLElement>(`[${ON}]`)
  if (was !== on) was?.removeAttribute(ON)
  if (!on) {
    root.removeAttribute("data-glide")
    return
  }
  on.setAttribute(ON, "")
  const { x, y } = offset(on, root)
  root.style.setProperty("--glide-x", `${x}px`)
  root.style.setProperty("--glide-y", `${y}px`)
  root.style.setProperty("--glide-w", `${on.offsetWidth}px`)
  root.style.setProperty("--glide-h", `${on.offsetHeight}px`)
  root.setAttribute("data-glide", root.hasAttribute("data-glide") ? "move" : "set")
}

export function useGlide<T extends HTMLElement>(selector: string): RefObject<T | null> {
  const ref = useRef<T>(null)
  const seen = useRef<{ root: HTMLElement; watch: ResizeObserver } | null>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (root) place(root, selector)
    if (seen.current?.root === root) return
    seen.current?.watch.disconnect()
    seen.current = null
    if (!root) return
    const watch = new ResizeObserver(() => place(root, selector))
    watch.observe(root)
    seen.current = { root, watch }
  })
  useEffect(
    () => () => {
      seen.current?.watch.disconnect()
      seen.current = null
    },
    []
  )
  return ref
}

export function Track({ children, ...rest }: ComponentProps<"div">) {
  const ref = useGlide<HTMLDivElement>('[aria-pressed="true"]')
  useSideways(ref, "", '[aria-pressed="true"]')
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  )
}

export function useMoved<T>(value: T): boolean {
  const [first] = useState(value)
  const [moved, setMoved] = useState(false)
  if (!moved && first !== value) setMoved(true)
  return moved
}

const motionOk = (): boolean => document.documentElement.dataset.motion !== "reduced" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches

export function land(el: Element | null | undefined, from: number): void {
  if (!el || !motionOk()) return
  el.animate(
    [
      { opacity: 0, transform: `translateY(${from}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
  )
}
