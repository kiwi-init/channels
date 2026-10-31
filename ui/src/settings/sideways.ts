import { useEffect, type RefObject } from "react"

const LINE_PX = 16

export function sidewaysTarget(at: number, max: number, deltaX: number, deltaY: number, lines: boolean): number | null {
  if (max <= 1 || Math.abs(deltaX) >= Math.abs(deltaY)) return null
  const to = Math.min(max, Math.max(0, at + deltaY * (lines ? LINE_PX : 1)))
  return to === at ? null : to
}

export function useSideways(ref: RefObject<HTMLElement | null>, active: string): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mark = () => {
      const max = el.scrollWidth - el.clientWidth
      el.toggleAttribute("data-more-start", max > 1 && el.scrollLeft > 1)
      el.toggleAttribute("data-more-end", max > 1 && el.scrollLeft < max - 1)
    }
    const wheel = (e: WheelEvent) => {
      const to = sidewaysTarget(el.scrollLeft, el.scrollWidth - el.clientWidth, e.deltaX, e.deltaY, e.deltaMode === WheelEvent.DOM_DELTA_LINE)
      if (to === null) return
      e.preventDefault()
      el.scrollLeft = to
    }
    const resize = new ResizeObserver(mark)
    mark()
    resize.observe(el)
    el.addEventListener("scroll", mark, { passive: true })
    el.addEventListener("wheel", wheel, { passive: false })
    return () => {
      resize.disconnect()
      el.removeEventListener("scroll", mark)
      el.removeEventListener("wheel", wheel)
    }
  }, [ref])

  useEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>(".side-row.is-on")
    if (!el || !on || el.scrollWidth - el.clientWidth <= 1) return
    on.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [ref, active])
}
