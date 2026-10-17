const MIN_SCALE = 1
export const MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2.5
const DISMISS_DISTANCE = 120
const TAP_SLOP = 8
const TAP_MS = 250
export const DOUBLE_TAP_MS = 300

export interface Box {
  width: number
  height: number
}

export interface Transform {
  scale: number
  x: number
  y: number
}

export interface Point {
  pageX: number
  pageY: number
}

export const identity: Transform = { scale: 1, x: 0, y: 0 }

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function clampPan(t: Transform, box: Box): Transform {
  const reachX = Math.max(0, ((t.scale - 1) * box.width) / 2)
  const reachY = Math.max(0, ((t.scale - 1) * box.height) / 2)
  return { scale: t.scale, x: Math.min(reachX, Math.max(-reachX, t.x)), y: Math.min(reachY, Math.max(-reachY, t.y)) }
}

export function gap(a: Point, b: Point): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
}

export function pinch(start: Transform, startGap: number, now: number, box: Box): Transform {
  if (startGap <= 0) return start
  const scale = Math.min(MAX_SCALE * 1.2, Math.max(MIN_SCALE * 0.7, start.scale * (now / startGap)))
  return clampPan({ scale, x: start.x, y: start.y }, box)
}

export function pan(start: Transform, dx: number, dy: number, box: Box): Transform {
  if (start.scale > MIN_SCALE) return clampPan({ scale: start.scale, x: start.x + dx, y: start.y + dy }, box)
  return { scale: MIN_SCALE, x: 0, y: dy }
}

export function settle(t: Transform, box: Box): Transform {
  const scale = clampScale(t.scale)
  return scale <= MIN_SCALE + 0.02 ? identity : clampPan({ ...t, scale }, box)
}

export function doubleTap(t: Transform): Transform {
  return t.scale > MIN_SCALE + 0.02 ? identity : { scale: DOUBLE_TAP_SCALE, x: 0, y: 0 }
}

export function dismissed(t: Transform): boolean {
  return t.scale <= MIN_SCALE + 0.02 && Math.abs(t.y) > DISMISS_DISTANCE
}

export function isTap(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) <= TAP_SLOP && ms <= TAP_MS
}
