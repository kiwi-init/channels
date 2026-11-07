import { startMeadow, type Meadow } from "~/start/meadow"

let current: Meadow | null = null

Object.assign(window, {
  meadow: {
    async start(still: boolean): Promise<boolean> {
      const box = document.getElementById("box")
      if (!box) return false
      current = await startMeadow(box, still)
      return current !== null
    },
    stop(): void {
      current?.dispose()
      current = null
    },
    hide(hidden: boolean): void {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
      document.dispatchEvent(new Event("visibilitychange"))
    },
  },
})
