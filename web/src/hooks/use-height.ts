import { useLayoutEffect, useState } from "react"

export function useHeight(): [(el: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0)
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!el) return
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight))
    watch.observe(el)
    return () => watch.disconnect()
  }, [el])
  return [setEl, height]
}
