import { DOUBLE_TAP_MS, dismissed, doubleTap, gap, identity, isTap, pan, pinch, settle, type Box, type Point, type Transform } from "./zoom"

export interface ViewerGestures {
  grant: () => void
  move: (touches: readonly Point[], dx: number, dy: number) => void
  release: (dx: number, dy: number) => void
  terminate: () => void
  reset: () => void
}

export interface ViewerGestureOptions {
  box: Box
  show: (t: Transform) => void
  springTo: (t: Transform) => void
  onClose: () => void
  now?: () => number
}

interface Touching {
  start: Transform
  current: Transform
  startGap: number
  startAt: number
  lastTap: number
  rebaseX: number
  rebaseY: number
}

const fresh = (): Touching => ({ start: identity, current: identity, startGap: 0, startAt: 0, lastTap: 0, rebaseX: 0, rebaseY: 0 })

export function createViewerGestures({ box, show, springTo, onClose, now = Date.now }: ViewerGestureOptions): ViewerGestures {
  let t = fresh()
  return {
    grant: () => {
      t.start = t.current
      t.startGap = 0
      t.startAt = now()
      t.rebaseX = 0
      t.rebaseY = 0
    },
    move: (touches, dx, dy) => {
      const [a, b] = touches
      if (a && b) {
        if (!t.startGap) {
          t.start = t.current
          t.startGap = gap(a, b)
        }
        t.current = pinch(t.start, t.startGap, gap(a, b), box)
      } else {
        if (t.startGap) {
          t.startGap = 0
          t.start = t.current
          t.rebaseX = dx
          t.rebaseY = dy
        }
        t.current = pan(t.start, dx - t.rebaseX, dy - t.rebaseY, box)
      }
      show(t.current)
    },
    release: (dx, dy) => {
      const at = now()
      if (isTap(dx, dy, at - t.startAt) && t.startGap === 0) {
        if (at - t.lastTap <= DOUBLE_TAP_MS) {
          t.lastTap = 0
          t.current = doubleTap(t.current)
          springTo(t.current)
        } else {
          t.lastTap = at
        }
        return
      }
      if (dismissed(t.current)) {
        onClose()
        return
      }
      t.current = settle(t.current, box)
      springTo(t.current)
    },
    terminate: () => {
      t.current = settle(t.current, box)
      springTo(t.current)
    },
    reset: () => {
      t = fresh()
    },
  }
}
