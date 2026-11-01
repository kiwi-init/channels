import { useEffect, useState, useSyncExternalStore } from "react"

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts"

interface Packed {
  reaction: string
  name: string
  feeling: string
}

export interface Gif extends Packed {
  key: string
}

export interface Catalog {
  groups: { reaction: string; items: Gif[] }[]
  byKey: (key: string) => Gif | undefined
}

const PART = /^[a-z0-9][a-z0-9-]{0,40}$/
const text = (v: unknown, most: number): v is string => typeof v === "string" && v.length > 0 && v.length <= most

export function readCatalog(raw: unknown): Catalog | null {
  if (!Array.isArray(raw)) return null
  const gifs: Gif[] = []
  for (const x of raw as unknown[]) {
    if (typeof x !== "object" || x === null) continue
    const { reaction, name, feeling } = x as Record<string, unknown>
    if (!text(reaction, 41) || !text(name, 41) || !PART.test(reaction) || !PART.test(name) || !text(feeling, 120)) continue
    gifs.push({ reaction, name, feeling, key: `${reaction}/${name}` })
  }
  if (!gifs.length) return null
  const byKey = new Map(gifs.map((g) => [g.key, g]))
  return {
    groups: [...new Set(gifs.map((g) => g.reaction))].map((reaction) => ({ reaction, items: gifs.filter((g) => g.reaction === reaction) })),
    byKey: (key) => byKey.get(key),
  }
}

const catalogs = new Map<string, Catalog | null>()
const asked = new Set<string>()
const listeners = new Set<() => void>()

export function loadCatalog(host: string, get: typeof fetch = fetch): Promise<void> {
  if (asked.has(host)) return Promise.resolve()
  asked.add(host)
  return get(`${host}/reactions/index.json`)
    .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? r.json() : null))
    .then(
      (raw: unknown) => void catalogs.set(host, readCatalog(raw)),
      () => {
        // A relay without the pack, or offline: no GIFs here, and the next start asks again.
        catalogs.set(host, null)
      }
    )
    .then(() => {
      for (const l of listeners) l()
    })
}

export const peekCatalog = (host: string): Catalog | null => catalogs.get(host) ?? null

export function useCatalog(host: string): Catalog | null {
  const got = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => peekCatalog(host)
  )
  useEffect(() => void loadCatalog(host), [host])
  return got
}

export const gifHost = (relay: string | undefined): string => (location.protocol.startsWith("http") ? location.origin : (relay ?? DEFAULT_RELAY).replace(/\/+$/, ""))

const blobs = new Map<string, Promise<Blob>>()

function gifBlob(host: string, g: Gif): Promise<Blob> {
  const url = `${host}/reactions/${g.key}.webp`
  let blob = blobs.get(url)
  if (!blob) {
    blob = fetch(url).then((r) => (r.ok && (r.headers.get("content-type") ?? "").startsWith("image/") ? r.blob() : Promise.reject(new Error(`not a GIF: ${r.status}`))))
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
