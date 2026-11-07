import { startMeadow, type Meadow } from "~/calm/meadow"

interface State {
  at: number
  needs: number
  still: boolean
}

const stage = document.createElement("div")
stage.style.cssText = "position:fixed;inset:0"
document.body.append(stage)

let meadow: Meadow | null = null
let state: State = { at: Date.now(), needs: 0, still: matchMedia("(prefers-reduced-motion: reduce)").matches }

const apply = (): void => {
  if (!meadow) return
  meadow.setClock(state.at)
  meadow.setAlert(state.needs > 0)
  meadow.setStill(state.still)
}

addEventListener("message", (e: MessageEvent) => {
  const m = e.data as { kiwi?: unknown; type?: unknown; at?: unknown; needs?: unknown; still?: unknown } | null
  if (e.source !== parent || !m || m.kiwi !== "afk" || m.type !== "state") return
  state = { at: typeof m.at === "number" ? m.at : Date.now(), needs: typeof m.needs === "number" ? m.needs : 0, still: m.still === true }
  apply()
})

void startMeadow(stage, state.still).then((m) => {
  if (!m) return
  meadow = m
  apply()
  requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({ kiwi: "afk", type: "ready" }, "*")))
})
