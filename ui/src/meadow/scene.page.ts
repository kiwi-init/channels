import { startMeadow, type Meadow } from "~/meadow/meadow"

let meadow: Promise<Meadow | null> | null = null

addEventListener("message", (e) => {
  if (e.source !== parent || e.data?.kiwi !== "afk" || e.data.type !== "state") return
  const still = e.data.still === true
  if (meadow) {
    void meadow.then((m) => m?.setStill(still))
    return
  }
  const box = document.getElementById("box")
  if (!box) return
  meadow = startMeadow(box, still)
  void meadow.then((m) => m && parent.postMessage({ kiwi: "afk", type: "ready" }, "*"))
})
