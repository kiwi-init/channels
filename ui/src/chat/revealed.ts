import { createContext, type RefObject } from "react"

export const FeedRevealed = createContext<RefObject<boolean> | null>(null)
