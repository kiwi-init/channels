import { useEffect, useState } from "react"

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts"

interface Packed {
  reaction: string
  name: string
  feeling: string
}

export interface Gif extends Packed {
  key: string
}

const packs = import.meta.glob<Packed[]>("../../../site/reactions/index.json", { eager: true, import: "default" })

const gifs: Gif[] = Object.values(packs)
  .flat()
  .map((g) => ({ ...g, key: `${g.reaction}/${g.name}` }))

export const gifByKey = (key: string): Gif | undefined => gifs.find((g) => g.key === key)

export const gifGroups: { reaction: string; items: Gif[] }[] = [...new Set(gifs.map((g) => g.reaction))].map((reaction) => ({
  reaction,
  items: gifs.filter((g) => g.reaction === reaction),
}))

export const gifHost = (relay: string | undefined): string => (location.protocol.startsWith("http") ? location.origin : (relay ?? DEFAULT_RELAY).replace(/\/+$/, ""))

const blobs = new Map<string, Promise<Blob>>()

function gifBlob(host: string, g: Gif): Promise<Blob> {
  const url = `${host}/reactions/${g.key}.webp`
  let blob = blobs.get(url)
  if (!blob) {
    blob = fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
    blobs.set(url, blob)
    blob.catch(() => {
      blobs.delete(url)
    })
  }
  return blob
}

export async function gifFile(host: string, g: Gif): Promise<File> {
  return new File([await gifBlob(host, g)], `${g.reaction}-${g.name}.webp`, { type: "image/webp" })
}

const srcs = new Map<string, string>()

export function useGifSrc(host: string, g: Gif): string | null {
  const url = `${host}/reactions/${g.key}.webp`
  const [, loaded] = useState(0)
  useEffect(() => {
    if (srcs.has(url)) return
    let live = true
    gifBlob(host, g).then(
      (blob) => {
        if (!srcs.has(url)) srcs.set(url, URL.createObjectURL(blob))
        if (live) loaded((n) => n + 1)
      },
      () => {
        // A GIF that can't be fetched (offline, or a relay without the pack) stays an empty tile.
      }
    )
    return () => {
      live = false
    }
  }, [host, g, url])
  return srcs.get(url) ?? null
}
