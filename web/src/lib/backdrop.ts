import { bridge } from "@/lib/secrets"

const root = () => document.documentElement

const dark = () => root().dataset.theme === "dark" || (root().dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)

const EVERY_MS = 60_000
let last = 0

function load() {
  if (Date.now() - last < EVERY_MS) return
  last = Date.now()
  const b = bridge()
  if (!b?.wallpaperBackdrop) return
  void b.wallpaperBackdrop(dark()).then(
    (url) => {
      if (url) root().style.setProperty("--backdrop", `url("${url}")`)
      else {
        root().style.removeProperty("--backdrop")
        delete root().dataset.frost
      }
    },
    () => {}
  )
}

export function startBackdrop() {
  if (root().dataset.frost !== "image") return
  load()
  window.addEventListener("focus", load)
}
