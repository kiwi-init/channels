import type { ChannelTile, HomeChannel } from "~/model"

export interface AfkRow {
  code: string
  title: string
  needs: number
  line: string | null
}

const SHOWN = 8
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

export function afkRows(tiles: readonly ChannelTile[], home: readonly HomeChannel[]): AfkRow[] {
  const byCode = new Map(home.map((h) => [h.code, h]))
  return tiles
    .filter((t) => t.state === "member" && (!t.muted || t.needsYou > 0))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.needsYou > 0) - Number(a.t.needsYou > 0) || b.t.last - a.t.last || a.i - b.i)
    .slice(0, SHOWN)
    .map(({ t }) => ({ code: t.code, title: t.title, needs: t.needsYou, line: lineOf(byCode.get(t.code)) }))
}

export function withOpened(home: readonly HomeChannel[], opened: HomeChannel | null): readonly HomeChannel[] {
  return opened ? [opened, ...home.filter((h) => h.code !== opened.code)] : home
}
