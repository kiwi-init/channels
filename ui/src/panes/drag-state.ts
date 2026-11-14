import { useSyncExternalStore } from "react"

import type { Carry, Edge } from "~/panes/store"

export interface Drag {
  carry: Carry
  label: string
  x: number
  y: number
  target: { code: string; id: string; edge: Edge; fill?: true; box: { x: number; y: number; w: number; h: number } } | null
}

let drag: Drag | null = null
const dragListeners = new Set<() => void>()
const subscribeDrag = (l: () => void) => (dragListeners.add(l), () => void dragListeners.delete(l))

export const useDrag = (): Drag | null => useSyncExternalStore(subscribeDrag, () => drag)

export function setDrag(next: Drag | null): void {
  drag = next
  for (const l of dragListeners) l()
}
