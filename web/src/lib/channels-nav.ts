import { createContext, useContext } from "react"

import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"

export interface ChannelsNav {
  rows: ChannelRow[]
  news: RowNews[]
  active: string
  onSelect: (code: string) => void
  onNew: () => void
  onFind: () => void
  onComputers: () => void
  onSettings: () => void
}

export const ChannelsNavContext = createContext<ChannelsNav | null>(null)

export const useChannelsNav = (): ChannelsNav | null => useContext(ChannelsNavContext)
