import { createContext } from "react"

export const MentionNames = createContext<((name: string) => string | undefined) | undefined>(undefined)
