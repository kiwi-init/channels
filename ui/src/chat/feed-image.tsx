import { Suspense } from "react"

import { later } from "~/kit/later"
import type { Image } from "~/model"

const shots = () => import("~/chat/image-button")
const ImageButton = later(() => shots().then((m) => m.ImageButton))

export function ShownImage({ image, open }: { image: Image; open: (url: string, alt: string) => void }) {
  return (
    <Suspense
      fallback={
        <span className="msg-image-spot" title={image.alt} role="status">
          Loading image…
        </span>
      }
    >
      <ImageButton image={image} onOpen={open} />
    </Suspense>
  )
}
