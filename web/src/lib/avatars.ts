import { avatarIndex } from "./avatar-pick"

const urls = import.meta.glob<string>("../../../assets/avatars/*.svg", { eager: true, query: "?url", import: "default" })

const robots: string[] = Object.entries(urls)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

const harnesses = import.meta.glob<string>("../../../assets/harness/*.svg", { eager: true, query: "?url", import: "default" })

export function harnessUrl(harness: string): string {
  return harnesses[`../../../assets/harness/${harness}.svg`] ?? ""
}

export function avatarUrl(key: string): string {
  return robots[avatarIndex(key, robots.length)] ?? ""
}
