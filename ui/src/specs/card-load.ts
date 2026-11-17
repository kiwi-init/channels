import type { SpecCard } from "~/specs/card"

type SpecCardView = typeof SpecCard

let loaded: SpecCardView | null = null

export const specCardNow = (): SpecCardView | null => loaded

export const loadSpecCard = (): Promise<SpecCardView> =>
  import("~/specs/card").then((m) => {
    loaded = m.SpecCard
    return m.SpecCard
  })
