import { NARROW, useMedia } from "~/kit/media"

export function useTabs(): boolean {
  return !useMedia(NARROW)
}
