import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react"
import type { ReactNode } from "react"

import { useAccessibilityOption } from "@/lib/accessibility"

const EASE = [0.2, 0.8, 0.2, 1] as const

export const MOVE: Transition = { type: "spring", bounce: 0, visualDuration: 0.28 }

export function Motion({ children }: { children: ReactNode }) {
  const reduce = useAccessibilityOption("reduce-motion")
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"} transition={{ duration: 0.2, ease: EASE }}>
      {children}
    </MotionConfig>
  )
}

export { AnimatePresence, motion as m }
