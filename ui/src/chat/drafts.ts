import { useSyncExternalStore } from "react"

import { MAX_BODY_LENGTH } from "@kiwi/core/protocol.ts"
import type { Upload, Where } from "~/model"

export const composerKey = (code: string, where: Where, inThread?: number): string => `${code}:${JSON.stringify(where)}:${inThread ?? ""}`

export const drafts = new Map<string, string>()
export const attached = new Map<string, Upload[]>()

const backs = new Map<string, number>()
const listeners = new Set<() => void>()

export type Placed = "composer" | "stash"

export function giveBack(key: string, text: string, images: readonly Upload[], stash: (key: string, text: string) => void): Placed {
  const busy = !!drafts.get(key)?.trim() || !!attached.get(key)?.length
  if (busy) stash(key, text)
  else {
    drafts.set(key, text)
    if (images.length) attached.set(key, [...images])
  }
  backs.set(key, (backs.get(key) ?? 0) + 1)
  for (const l of listeners) l()
  return busy ? "stash" : "composer"
}

export function useGivenBack(key: string): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => backs.get(key) ?? 0
  )
}

const count = (n: number): string => n.toLocaleString("en")

export function tooLong(text: string): string | null {
  const over = text.length - MAX_BODY_LENGTH
  return over > 0 ? `Too long to send: ${count(text.length)} characters, ${count(over)} over the ${count(MAX_BODY_LENGTH)} limit` : null
}

export function backWords(why: string, placed: Placed, images: number): string {
  const lost = placed === "stash" && images ? `; its ${images === 1 ? "image" : `${images} images`} didn't fit in the stash` : ""
  return placed === "composer" ? `Not sent: ${why}. It's back in the composer.` : `Not sent: ${why}. It's in the stash: ⇧⌘S brings it back${lost}.`
}
