export interface TabRoom {
  widths: number[]
  room: number
  more: number
  gap: number
}

const span = (widths: number[], gap: number) => widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1)

export function fitTabs({ widths, room, more, gap }: TabRoom, open: number): number[] {
  const all = widths.map((_, i) => i)
  if (span(widths, gap) <= room) return all
  const left = room - more - gap
  const shown: number[] = []
  for (const i of all) {
    if (span([...shown.map((s) => widths[s]!), widths[i]!], gap) > left) break
    shown.push(i)
  }
  if (open < 0 || open >= widths.length || shown.includes(open)) return shown
  while (shown.length && span([...shown.map((s) => widths[s]!), widths[open]!], gap) > left) shown.pop()
  return [...shown, open]
}
