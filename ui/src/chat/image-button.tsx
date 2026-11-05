import { useEffect, useState } from "react"

import { FEED_BOX, keyOf, scaleFor, thumbs, warmFor, type Shot } from "~/chat/thumbs"
import type { Image } from "~/model"

export const warmFeed = (id: string, url: string): Promise<Shot> => warmFor(id, url, FEED_BOX)

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

function useThumb(id: string | undefined, url: string, box: number): string {
  const scale = scaleFor(window.devicePixelRatio)
  const key = id === undefined ? null : keyOf(id, box, scale)
  const [, made] = useState(0)
  const [lost, setLost] = useState<string | null>(null)
  useEffect(() => {
    if (key === null) return
    let live = true
    const had = thumbs.peek(key) !== null
    thumbs.take(key, url, box, scale).then(
      () => {
        if (live && !had) made((n) => n + 1)
      },
      () => {
        if (live) setLost(key)
      }
    )
    return () => {
      live = false
      thumbs.free(key)
    }
  }, [key, url, box, scale])
  if (key === null || lost === key) return url
  const shot = thumbs.peek(key)
  return shot ? (shot.thumb ?? url) : BLANK
}

export function ImageButton({ image, onOpen }: { image: Image; onOpen: (url: string, alt: string) => void }) {
  const src = useThumb(image.id, image.url, FEED_BOX)
  const width = image.width || undefined
  const height = image.height || undefined
  return (
    <button type="button" className="msg-image" aria-label={`Open ${image.alt || "image"}`} onClick={() => onOpen(image.url, image.alt)}>
      <img src={src} alt={image.alt} width={width} height={height} draggable={src === image.url ? undefined : false} />
      {src !== image.url && <img className="msg-image-full" src={image.url} alt={image.alt} width={width} height={height} />}
    </button>
  )
}
