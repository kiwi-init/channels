import { useEffect, useMemo, useRef, useState } from "react"

import { isRasterMime, type ImageAttachment, type Message as Wire } from "@kiwi/core/protocol.ts"
import type { ChannelLink } from "@/lib/channel-ops"
import type { Image as Picture } from "~/model"
import type { Pictures } from "~/live/map"

const RECENT = 300

async function picture(ch: ChannelLink, img: ImageAttachment): Promise<Picture | null> {
  if (!isRasterMime(img.mime)) return null
  const data = img.data ?? (await ch.image(img))
  if (!data) return null
  const url = `data:${img.mime};base64,${data}`
  const el = new window.Image()
  el.src = url
  await el.decode()
  return { url, width: el.naturalWidth, height: el.naturalHeight, alt: img.name }
}

export function usePictures(ch: ChannelLink, messages: readonly Wire[]): Pictures {
  const cache = useRef(new Map<string, Picture | null>())
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    const wanted = messages.slice(-RECENT).flatMap((m) => (m.imgs ?? []).map((img, i) => ({ key: `${m.seq}:${i}`, img })))
    for (const { key, img } of wanted) {
      if (cache.current.has(key)) continue
      cache.current.set(key, null)
      void picture(ch, img).then(
        (p) => {
          if (!p) return
          cache.current.set(key, p)
          if (live) setVersion((v) => v + 1)
        },
        () => {
          // An image that won't load or decode stays out of the message; its text still shows.
        }
      )
    }
    return () => {
      live = false
    }
  }, [ch, messages])
  return useMemo(() => ({ version, get: (seq: number, i: number) => cache.current.get(`${seq}:${i}`) ?? undefined }), [version])
}
