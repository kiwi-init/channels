import { useEffect } from "react"

let paletteReturn: HTMLElement | null = null

export function takePaletteReturn(): HTMLElement | null {
  const back = paletteReturn
  paletteReturn = null
  return back
}

export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        paletteReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null
        open()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
}
