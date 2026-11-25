import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"

import { fixes, type Step } from "~/panes/history"
import { leafOf, MIN_H, MIN_W, type Edge, type Node } from "~/panes/store"

type Ask = Parameters<KiwiBridge["tilingPick"]>[0]
type Picks = NonNullable<Awaited<ReturnType<KiwiBridge["tilingPick"]>>>
type Seen = Pick<Step, "screen" | "panes">

const KINDS = ["task", "panel:task", "panel:pr", "panel:issue", "panel:thread", "activity"]
const SURE = 0.67
const WAIT = 400
const PAST = 40

const held = new Map<string, { root: Node; picks: Picks }>()
const timers = new Map<string, number>()

export function smartSpot(code: string, root: Node, what: string): { id: string; edge: Edge } | null {
  const got = held.get(code)
  const pick = got?.root === root ? got.picks[what] : undefined
  return pick && pick.p >= SURE && leafOf(root, pick.pane) ? { id: pick.pane, edge: pick.edge } : null
}

export function keep(code: string, root: Node, picks: Picks): void {
  held.set(code, { root, picks })
}

export function spotsOf(seen: Seen): Ask["spots"] {
  const { w, h } = seen.screen
  const wide = (p: Seen["panes"][number]) => p.w * w >= 2 * MIN_W
  const tall = (p: Seen["panes"][number]) => p.h * h >= 2 * MIN_H
  const open = seen.panes.filter((p) => p.what !== "blank" && (wide(p) || tall(p)))
  const usual = open.toSorted((a, b) => b.w * b.h - a.w * a.h)[0]
  const usualEdge: Edge = usual && wide(usual) && usual.w * w >= usual.h * h * 0.9 ? "right" : "bottom"
  return open.flatMap((p) => {
    const edges: Edge[] = [...(wide(p) ? (["left", "right"] as const) : []), ...(tall(p) ? (["top", "bottom"] as const) : [])]
    return edges.map((edge) => ({ pane: p.pane, edge, ...(p === usual && edge === usualEdge ? { usual: true as const } : {}) }))
  })
}

export function pastOf(steps: readonly Step[]): Ask["past"] {
  const found = fixes(steps)
  const fixedBy = new Map(found.map((f) => [f.placed, f.fixed]))
  const fixing = new Set(found.map((f) => f.fixed))
  return steps
    .flatMap((s): Ask["past"] => {
      if ((s.act !== "open" && s.act !== "move") || !s.edge || !s.target || fixing.has(s)) return []
      const f = fixedBy.get(s)
      const then = !f ? "kept" : f.act === "move" ? "moved" : f.act === "close" ? "closed" : "resized"
      const to = f?.act === "move" && f.target && f.edge ? { to: { beside: f.target, edge: f.edge } } : {}
      return [{ what: s.what, by: s.by, beside: s.target, edge: s.edge, then, ...to }]
    })
    .slice(-PAST)
}

export function relearn(code: string, root: Node, seen: Seen, steps: readonly Step[]): void {
  const b = bridge()
  if (!b || typeof b.tilingPick !== "function") return
  window.clearTimeout(timers.get(code))
  timers.set(
    code,
    window.setTimeout(() => {
      const past = pastOf(steps)
      const spots = spotsOf(seen)
      if (seen.screen.w === 0 || spots.length === 0 || !past.some((p) => p.by === "hand" || p.then !== "kept")) return
      const panes = seen.panes.map(({ pane, ...at }) => ({ id: pane, ...at }))
      b.tilingPick({ screen: seen.screen, panes, spots, kinds: KINDS, past }).then(
        (picks) => picks && keep(code, root, picks),
        () => held.delete(code)
      )
    }, WAIT)
  )
}
