import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { blobRef, isRasterMime, type ImageAttachment, type Message as Wire } from "@kiwi/core/protocol.ts"
import type { ChannelLink } from "@/lib/channel-ops"
import type { Image as Picture, ImageSpot } from "~/model"
import type { Pictures } from "~/live/map"

const RETRIES = 3
const RETRY_MS = 5_000

type Entry = { state: "loading" } | { state: "ready"; picture: Picture } | { state: "failed" } | { state: "gone" }

const pause = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const loaders = new Map<string, (spot: string) => void>()

export const loadPicture = (code: string, spot: string): void => loaders.get(code)?.(spot)

async function picture(ch: ChannelLink, img: ImageAttachment, full: boolean): Promise<Picture | null> {
  const ref = full ? blobRef(img) : null
  const mime = ref?.mime ?? img.mime
  if (!isRasterMime(mime)) return null
  const data = ref ? await ch.image({ name: img.name, mime: img.mime, ref }) : (img.data ?? (await ch.image(img)))
  if (!data) return null
  const url = `data:${mime};base64,${data}`
  const el = new window.Image()
  el.src = url
  await el.decode()
  return { url, width: el.naturalWidth, height: el.naturalHeight, alt: img.name }
}

export function spotOf(entry: Entry | undefined, spot: string, alt: string): Picture | ImageSpot {
  if (entry?.state === "ready") return entry.picture
  return { spot, alt, state: entry?.state === "failed" ? "failed" : entry?.state === "gone" ? "gone" : "waiting" }
}

export function usePictures(code: string, ch: ChannelLink, messages: readonly Wire[]): Pictures {
  const cache = useRef(new Map<string, Entry>())
  const bySeq = useRef(new Map<number, Wire>())
  const live = useRef(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    bySeq.current = new Map(messages.map((m) => [m.seq, m]))
  }, [messages])

  const load = useCallback(
    (spot: string) => {
      const was = cache.current.get(spot)
      if (was && was.state !== "failed") return
      const [seq, i] = spot.split(":").map(Number)
      const img = bySeq.current.get(seq ?? -1)?.imgs?.[i ?? -1]
      if (!img) return
      const settle = (entry: Entry) => {
        cache.current.set(spot, entry)
        if (live.current) setVersion((v) => v + 1)
      }
      settle({ state: "loading" })
      void (async () => {
        const preview = blobRef(img) && img.data !== undefined ? await picture(ch, img, false).catch(() => null) : null
        if (preview) settle({ state: "ready", picture: preview })
        for (let tries = 0; ; tries++) {
          try {
            const p = (await picture(ch, img, true)) ?? preview
            return settle(p ? { state: "ready", picture: p } : { state: "gone" })
          } catch {
            // The relay or the decoder failed this time: try again a few times, then keep the preview or offer Retry.
            if (tries >= RETRIES) return settle(preview ? { state: "ready", picture: preview } : { state: "failed" })
            await pause(RETRY_MS)
            if (!live.current) return
          }
        }
      })()
    },
    [ch]
  )

  useEffect(() => {
    live.current = true
    loaders.set(code, load)
    return () => {
      live.current = false
      if (loaders.get(code) === load) loaders.delete(code)
    }
  }, [code, load])

  return useMemo(() => ({ version, get: (seq: number, i: number, alt: string) => spotOf(cache.current.get(`${seq}:${i}`), `${seq}:${i}`, alt) }), [version])
}
