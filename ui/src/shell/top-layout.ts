import { useLayout } from "@kiwi/app/layout.ts"
import { NARROW, useMedia } from "~/kit/media"

export function useTopLayout(): boolean {
  const layout = useLayout()
  const narrow = useMedia(NARROW)
  return layout === "top" && !narrow
}
