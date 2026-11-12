import { useLayout } from "@kiwi/app/layout.ts"
import { NARROW, useMedia } from "~/kit/media"

export function useTabs(): boolean {
  return !useMedia(NARROW)
}

export function useTopLayout(): boolean {
  const layout = useLayout()
  const tabs = useTabs()
  return layout === "top" && tabs
}
