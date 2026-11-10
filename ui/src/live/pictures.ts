import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { isRasterMime, type ImageAttachment, type Message as Wire } from "@kiwi/core/protocol.ts"
import type { ChannelLink } from "@kiwi/channel/channel-ops.ts"
import type { Image as Picture, ImageSpot } from "~/model"
import type { Pictures } from "~/live/map"
import { onPictureSeen, pictureVisible } from "~/chat/picture-watch"

const RETRIES = 3
const RETRY_MS = 5_000

export type Entry =
  | { state: "loading"; width?: number; height?: number }
  | { state: "ready"; picture: Picture }
  | { state: "failed" }
  | { state: "gone" }
  | { state: "shed"; width: number; height: number }

const KEEP_PICTURES = 24

export class Shelf {
  private readonly held = new Map<string, boolean>()

  constructor(private readonly keep: number) {}

  put(spot: string, visible: boolean): string[] {
    this.held.delete(spot)
    this.held.set(spot, visible)
    return this.trim(spot)
  }

  drop(spot: string): void {
    this.held.delete(spot)
  }

  private trim(newest: string): string[] {
    const shed: string[] = []
    for (const [spot, visible] of this.held) {
      if (this.held.size - shed.length <= this.keep) break
      if (!visible && spot !== newest) shed.push(spot)
    }
    for (const spot of shed) this.held.delete(spot)
    return shed
  }
}

const pause = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const loaders = new Map<string, (spot: string) => void>()

export const loadPicture = (code: string, spot: string): void => loaders.get(code)?.(spot)

async function picture(ch: ChannelLink, img: ImageAttachment, id: string): Promise<Picture | null> {
  if (!isRasterMime(img.mime)) return null
  const data = img.data ?? (await ch.image(img))
  if (!data) return null
  const url = `data:${img.mime};base64,${data}`
  const { width, height } = await import("~/chat/image-button").then((m) => m.warmFeed(id, url))
  return { url, width, height, alt: img.name, id }
}

export function spotOf(entry: Entry | undefined, spot: string, alt: string): Picture | ImageSpot {
  if (entry?.state === "ready") return entry.picture
  if ((entry?.state === "shed" || entry?.state === "loading") && entry.width && entry.height) return { spot, alt, state: "waiting", width: entry.width, height: entry.height }
  return { spot, alt, state: entry?.state === "failed" ? "failed" : entry?.state === "gone" ? "gone" : "waiting" }
}

const shown = (entry: Entry | undefined): string => (entry?.state === "ready" ? "ready" : entry?.state === "failed" ? "failed" : entry?.state === "gone" ? "gone" : "waiting")

export const showsAnew = (was: Entry | undefined, next: Entry): boolean => shown(was) !== shown(next)

export function usePictures(code: string, ch: ChannelLink, messages: readonly Wire[]): Pictures {
  const cache = useRef(new Map<string, Entry>())
  const shelf = useRef(new Shelf(KEEP_PICTURES))
  const bySeq = useRef(new Map<number, Wire>())
  const live = useRef(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    bySeq.current = new Map(messages.map((m) => [m.seq, m]))
  }, [messages])

  const load = useCallback(
    (spot: string) => {
      const was = cache.current.get(spot)
      if (was && was.state !== "failed" && was.state !== "shed") return
      const [seq, i] = spot.split(":").map(Number)
      const img = bySeq.current.get(seq ?? -1)?.imgs?.[i ?? -1]
      if (!img) return
      const shedOld = (spots: string[]): boolean => {
        for (const old of spots) {
          const had = cache.current.get(old)
          if (had?.state !== "ready") continue
          if (had.picture.id) onPictureSeen(had.picture.id, null)
          cache.current.set(old, { state: "shed", width: had.picture.width, height: had.picture.height })
        }
        return spots.length > 0
      }
      const keep = (p: Picture): boolean => {
        const id = p.id
        if (!id) return false
        onPictureSeen(id, (visible) => {
          if (cache.current.get(spot)?.state !== "ready") return
          if (shedOld(shelf.current.put(spot, visible)) && live.current) setVersion((v) => v + 1)
        })
        return shedOld(shelf.current.put(spot, pictureVisible(id)))
      }
      const settle = (entry: Entry) => {
        const anew = showsAnew(cache.current.get(spot), entry)
        cache.current.set(spot, entry)
        const shed = entry.state === "ready" && keep(entry.picture)
        if (entry.state !== "ready" && entry.state !== "loading") shelf.current.drop(spot)
        if (live.current && (anew || shed)) setVersion((v) => v + 1)
      }
      settle(was?.state === "shed" ? { state: "loading", width: was.width, height: was.height } : { state: "loading" })
      void (async () => {
        for (let tries = 0; ; tries++) {
          try {
            const p = await picture(ch, img, img.ref?.id ?? `${code}:${spot}`)
            return settle(p ? { state: "ready", picture: p } : { state: "gone" })
          } catch {
            // The relay or the decoder failed this time: try again a few times, then offer Retry.
            if (tries >= RETRIES) return settle({ state: "failed" })
            await pause(RETRY_MS)
            if (!live.current) return
          }
        }
      })()
    },
    [ch, code]
  )

  useEffect(() => {
    live.current = true
    loaders.set(code, load)
    const held = cache.current
    return () => {
      live.current = false
      if (loaders.get(code) === load) loaders.delete(code)
      for (const entry of held.values()) if (entry.state === "ready" && entry.picture.id) onPictureSeen(entry.picture.id, null)
    }
  }, [code, load])

  return useMemo(() => ({ version, get: (seq: number, i: number, alt: string) => spotOf(cache.current.get(`${seq}:${i}`), `${seq}:${i}`, alt) }), [version])
}
