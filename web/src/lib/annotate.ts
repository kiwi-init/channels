export type Point = { x: number; y: number }

export type Tool = "move" | "pen" | "arrow" | "box" | "text" | "hide"

export type Ink = "alert" | "decide" | "accent" | "ink"

export const INKS: readonly Ink[] = ["alert", "decide", "accent", "ink"]

export const TOOL_KEYS: Record<string, Tool> = { v: "move", p: "pen", a: "arrow", b: "box", t: "text", h: "hide" }

export type Mark =
  | { kind: "pen"; ink: Ink; points: Point[] }
  | { kind: "arrow"; ink: Ink; from: Point; to: Point }
  | { kind: "box"; ink: Ink; from: Point; to: Point }
  | { kind: "text"; ink: Ink; at: Point; text: string }
  | { kind: "hide"; from: Point; to: Point }

export type Rect = { x: number; y: number; w: number; h: number }

export function rect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function strokeWidth(width: number, height: number): number {
  return Math.max(2, Math.round(Math.max(width, height) / 400))
}

export function textSize(width: number, height: number): number {
  return Math.max(14, Math.round(Math.max(width, height) / 48))
}

export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const wing = (turn: number): Point => ({ x: to.x - size * Math.cos(angle + turn), y: to.y - size * Math.sin(angle + turn) })
  return [wing(Math.PI / 7), wing(-Math.PI / 7)]
}

export function penPath(points: Point[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(" ")
}

export function meaningful(mark: Mark, min: number): boolean {
  switch (mark.kind) {
    case "pen":
      return mark.points.length > 1
    case "text":
      return mark.text.trim().length > 0
    case "arrow":
      return Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) >= min
    case "box":
    case "hide": {
      const r = rect(mark.from, mark.to)
      return r.w >= min && r.h >= min
    }
  }
}

export function toImage(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, natural: { width: number; height: number }): Point {
  const x = ((clientX - box.left) / box.width) * natural.width
  const y = ((clientY - box.top) / box.height) * natural.height
  return { x: Math.min(natural.width, Math.max(0, x)), y: Math.min(natural.height, Math.max(0, y)) }
}

export function fitSide(width: number, height: number, maxSide: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

export function markedName(name: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png")
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "image"
  return `${base}-marked.${ext}`
}

export function base64Bytes(data: string): number {
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.floor((data.length * 3) / 4) - pad
}
