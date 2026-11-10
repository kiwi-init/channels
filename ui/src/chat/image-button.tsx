import "~/i18n/en/chat-later"
import { useEffect, useRef, useState, type DragEvent } from "react"

import { originalBlob, originalData, originalMime } from "~/chat/originals"
import { seePicture } from "~/chat/picture-watch"
import { FEED_BOX, keyOf, scaleFor, thumbs, warmFor, type Shot } from "~/chat/thumbs"
import { t } from "~/i18n/i18n"
import type { Image } from "~/model"

export const warmFeed = (id: string, url: string): Promise<Shot> => warmFor(id, url, FEED_BOX)

const SEEN_MARGIN = "1200px 0px"

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

function useSeen(id: string | undefined): (el: HTMLButtonElement | null) => void {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!el || id === undefined) return
    if (typeof IntersectionObserver === "undefined") {
      seePicture(id, true)
      return () => seePicture(id, false)
    }
    let seen = false
    const watch = new IntersectionObserver(
      (entries) => {
        const now = entries.at(-1)?.isIntersecting ?? false
        if (now === seen) return
        seen = now
        seePicture(id, now)
      },
      { rootMargin: SEEN_MARGIN }
    )
    watch.observe(el)
    return () => {
      watch.disconnect()
      if (seen) seePicture(id, false)
    }
  }, [el, id])
  return setEl
}

export function ImageButton({ image, onOpen }: { image: Image; onOpen: (url: string, alt: string) => void }) {
  const src = useThumb(image.id, image.url, FEED_BOX)
  const at = useSeen(image.id)
  const carried = useRef<{ url: string; data: string } | null>(null)
  const ready = () => {
    if (carried.current?.url === image.url || !originalBlob(image.url)) return
    const url = image.url
    void originalData(url).then(
      (data) => void (carried.current = { url, data: `data:${originalMime(url)};base64,${data}` }),
      () => {
        // The picture was shed while the pointer was down: the drag carries what the browser gives it.
      }
    )
  }
  const carry = (e: DragEvent<HTMLButtonElement>) => {
    const got = carried.current
    if (got?.url !== image.url) return
    e.dataTransfer.setData("text/uri-list", got.data)
    e.dataTransfer.setData("text/html", `<img src="${got.data}" alt="${image.alt.replace(/[&"<>]/g, "")}">`)
  }
  const width = image.width || undefined
  const height = image.height || undefined
  return (
    <button
      ref={at}
      type="button"
      className="msg-image"
      onPointerDown={ready}
      onDragStart={carry}
      aria-label={image.alt ? t("chat.image.button.open", { name: image.alt }) : t("chat.image.button.open.image")}
      onClick={() => onOpen(image.url, image.alt)}
    >
      <img src={src} alt={image.alt} width={width} height={height} draggable={src === image.url ? undefined : false} />
      {src !== image.url && <img className="msg-image-full" src={image.url} alt={image.alt} width={width} height={height} />}
    </button>
  )
}
