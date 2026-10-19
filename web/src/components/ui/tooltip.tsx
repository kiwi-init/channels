import type { ReactElement, ReactNode } from "react"

import { later } from "@/lib/later"

type TooltipProps = { label: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }

const tooltip = later<TooltipProps>(
  () => import("./tooltip-base").then((m) => m.Tooltip),
  ({ children }) => children
)

export const Tooltip = tooltip.View
