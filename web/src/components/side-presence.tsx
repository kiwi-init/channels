import type { ReactNode } from "react"

import { AnimatePresence, Motion } from "./motion"

export function SidePresence({ children }: { children: ReactNode }) {
  return (
    <Motion>
      <AnimatePresence mode="popLayout">{children}</AnimatePresence>
    </Motion>
  )
}
