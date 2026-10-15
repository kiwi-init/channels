export const HEAD_BURST_MS = 4_000
export const HEAD_ENTRANCE_MS = 1_600

export type HeadMotion = "loop" | "burst" | "entrance"

export interface HeadSurroundings {
  focused: boolean
  onScreen: boolean
  reducedMotion: boolean
  held: boolean
}

export function headMotion(loop: boolean, live: boolean): HeadMotion {
  if (loop) return "loop"
  return live ? "burst" : "entrance"
}

export function headMoves(motion: HeadMotion, bursting: boolean, around: HeadSurroundings): boolean {
  if (around.held || around.reducedMotion || !around.focused || !around.onScreen) return false
  return motion === "loop" || bursting
}
