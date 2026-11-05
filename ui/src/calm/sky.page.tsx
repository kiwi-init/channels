import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

import Sky from "~/calm/sky"

let root: Root | null = null

Object.assign(window, {
  sky: {
    mount() {
      const box = document.getElementById("box")
      if (!box) return
      root = createRoot(box)
      root.render(createElement(Sky))
    },
    unmount() {
      root?.unmount()
      root = null
    },
    hide(hidden: boolean) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
      document.dispatchEvent(new Event("visibilitychange"))
    },
  },
})
