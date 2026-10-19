import { ROBOT_FACES, type RobotFace } from "@kiwi/core/protocol.ts"

import { avatarIndex } from "./avatar-pick"

const urls = import.meta.glob<string>("../../../assets/avatars/*.svg", { eager: true, query: "?url", import: "default" })

const robots: string[] = Object.entries(urls)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

const harnesses = import.meta.glob<string>("../../../assets/harness/*.svg", { eager: true, query: "?no-inline", import: "default" })

export function harnessUrl(harness: string): string {
  return harnesses[`../../../assets/harness/${harness}.svg`] ?? ""
}

export function avatarUrl(key: string): string {
  return robots[avatarIndex(key, robots.length)] ?? ""
}

export function robotUrl(face: RobotFace): string {
  const hit = Object.entries(urls).find(([path]) => path.endsWith(`-${face}.svg`))
  return hit?.[1] ?? ""
}

export function robotFor(key: string): RobotFace {
  return ROBOT_FACES[avatarIndex(key, ROBOT_FACES.length)]!
}
