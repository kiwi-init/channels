import { lazy, Suspense, useSyncExternalStore } from "react"

import { store } from "~/live/value"

const shown = store<{ url: string; alt: string } | null>(null)

export const viewImage = (url: string, alt = ""): void => shown.set({ url, alt })

const Annotator = lazy(() => import("~/chat/annotator"))

export function ImageViews() {
  const image = useSyncExternalStore(shown.subscribe, shown.get)
  return image ? (
    <Suspense fallback={null}>
      <Annotator key={image.url} image={image} onClose={() => shown.set(null)} />
    </Suspense>
  ) : null
}
