import { bridge } from "@/lib/secrets"

const root = () => document.documentElement

const dark = () => root().dataset.theme === "dark" || (root().dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)

function load() {
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
