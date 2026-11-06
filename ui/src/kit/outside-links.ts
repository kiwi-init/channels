import { bridge } from "@kiwi/secrets/secrets.ts"

function linkOf(e: MouseEvent): string | null {
  const a = e.target instanceof Element ? e.target.closest("a") : null
  const raw = a?.getAttribute("href") ?? a?.getAttribute("xlink:href")
  if (!raw) return null
  try {
    const u = new URL(raw, location.href)
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null
  } catch {
    // An href that isn't a URL is no link to the browser; the click goes on as the page wrote it.
    return null
  }
}

export function openLinksOutside(): void {
  const b = bridge()
  if (!b) return
  const open = (e: MouseEvent) => {
    if (e.defaultPrevented || (e.type === "auxclick" && e.button !== 1)) return
    const url = linkOf(e)
    if (!url) return
    e.preventDefault()
    void b.openExternal(url).catch(() => {})
  }
  addEventListener("click", open)
  addEventListener("auxclick", open)
}
