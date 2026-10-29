import { Suspense, useEffect, useRef } from "react"

import "~/styles/palette.css"
import { later } from "~/kit/later"
import { useApp } from "~/nav"

const Finder = later(() => import("~/palette/finder").then((m) => m.Finder))

export function Palette() {
  const { nav, go } = useApp()
  const open = nav.dialog === "palette"
  const ref = useRef<HTMLDialogElement>(null)
  const back = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      back.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      el.showModal()
    }
    if (!open && el.open) {
      el.close()
      const to = back.current
      back.current = null
      if (to?.isConnected && !document.querySelector("dialog[open]")) to.focus()
    }
  }, [open])
  const close = () => go({ to: "dialog", dialog: null })
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Jump to"
      onClose={() => open && close()}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      {open && (
        <Suspense fallback={null}>
          <Finder />
        </Suspense>
      )}
    </dialog>
  )
}
