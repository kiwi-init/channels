import type { ChannelTile, HomeChannel } from "~/model"
import type { ModChannel } from "~/mods/protocol"

const MOST = 200
const LINE_CLIP = 90

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= LINE_CLIP ? line : `${line.slice(0, LINE_CLIP - 1).trimEnd()}…`
}

function lineOf(home: HomeChannel | undefined): string | null {
  const task = home?.moving[0]
  if (task) return clip([task.who, task.title, task.state].filter(Boolean).join(" · "))
  if (home?.said) return clip(`${home.said.from}: ${home.said.text}`)
  return null
}

export function modChannels(tiles: readonly ChannelTile[], home: readonly HomeChannel[]): ModChannel[] {
  const byCode = new Map(home.map((h) => [h.code, h]))
  return tiles
    .filter((t) => t.state === "member" && (!t.muted || t.needsYou > 0))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.needsYou > 0) - Number(a.t.needsYou > 0) || b.t.last - a.t.last || a.i - b.i)
    .slice(0, MOST)
    .map(({ t }) => ({ code: t.code, title: t.title, needs: t.needsYou, last: t.last, line: lineOf(byCode.get(t.code)) }))
}

export const channelsFor = (mod: { state: string; needs: readonly string[] } | undefined, list: ModChannel[]): ModChannel[] | null =>
  mod?.state === "on" && mod.needs.includes("channels") ? list : null
