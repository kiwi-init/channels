import { openUrl } from "~/mods/frame/wire"

export function openOutside(url: string): void {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) openUrl(u)
}
