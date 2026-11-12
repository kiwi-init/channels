import { createContext, use } from "react"

import type { Doc } from "~/panes/store"

export interface PaneScope {
  doc: Doc | null
  show: (doc: Doc) => void
}

export const PaneContext = createContext<PaneScope | null>(null)

export const usePane = (): PaneScope | null => use(PaneContext)
