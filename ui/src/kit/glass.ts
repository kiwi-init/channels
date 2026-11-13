import { bridge } from "@kiwi/secrets/secrets.ts"

type Page = Pick<HTMLElement, "dataset" | "style">

const EVERY_MS = 60_000
let drawn = 0

export function showGlass(on: boolean, page: Page = document.documentElement): void {
  if (on) page.dataset.glass = "material"
  else delete page.dataset.glass
}

export function showWallpaper(url: string | null, page: Page = document.documentElement): void {
  if (url) page.style.setProperty("--backdrop", `url("${url}")`)
  else {
    page.style.removeProperty("--backdrop")
    delete page.dataset.glass
  }
}

const dark = (page: HTMLElement): boolean => page.dataset.theme === "dark" || (page.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)

function drawWallpaper(): void {
  const page = document.documentElement
  if (page.dataset.glass !== "image" || Date.now() - drawn < EVERY_MS) return
  drawn = Date.now()
  void bridge()
    ?.wallpaperBackdrop(dark(page))
    .then(showWallpaper)
    .catch(() => {
      // A wallpaper that can't be read now is asked for again on the next focus; the frame keeps the colour under it.
    })
}

export function startGlass(): void {
  bridge()?.onFrost(showGlass)
  drawWallpaper()
  window.addEventListener("focus", drawWallpaper)
}
