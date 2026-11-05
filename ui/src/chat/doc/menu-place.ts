export interface Caret {
  left: number
  top: number
  above: number
}

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

export interface Place {
  left: number
  top: number
  maxHeight: number | undefined
}

const GAP = 8

export function menuPlace(at: Caret, size: { width: number; height: number }, host: Box, frame: Box): Place {
  const below = frame.bottom - (host.top + at.top) - GAP
  const over = host.top + at.above - frame.top - GAP
  const down = size.height <= below || below >= over
  const room = Math.max(0, down ? below : over)
  const height = Math.min(size.height, room)
  const right = frame.right - host.left - size.width - GAP
  return {
    left: Math.max(Math.min(at.left, right), frame.left - host.left + GAP, 0),
    top: down ? at.top : at.above - height,
    maxHeight: size.height > room ? room : undefined,
  }
}

export function frameOf(el: Element): Box {
  const feed = el.closest(".feed")?.getBoundingClientRect()
  return {
    top: Math.max(feed?.top ?? 0, 0),
    bottom: Math.min(feed?.bottom ?? innerHeight, innerHeight),
    left: Math.max(feed?.left ?? 0, 0),
    right: Math.min(feed?.right ?? innerWidth, innerWidth),
  }
}
