import { AnimatePresence, MotionConfig, motion, useIsPresent } from "motion/react"
import type { ReactNode } from "react"

import { useAccessibilityOption } from "@/lib/accessibility"

const EASE = [0.2, 0.8, 0.2, 1] as const

export function Motion({ children }: { children: ReactNode }) {
  const reduce = useAccessibilityOption("reduce-motion")
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"} transition={{ duration: 0.2, ease: EASE }}>
      {children}
    </MotionConfig>
  )
}

export { AnimatePresence, motion as m, useIsPresent }
