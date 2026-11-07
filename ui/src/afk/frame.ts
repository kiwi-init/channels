import { runScene } from "./run-scene"

let ran = false

addEventListener("message", (e: MessageEvent) => {
  const m = e.data as { kiwi?: unknown; type?: unknown; html?: unknown } | null
  if (ran || e.source !== parent || !m || m.kiwi !== "afk" || m.type !== "scene" || typeof m.html !== "string") return
  ran = true
  runScene(m.html)
})
