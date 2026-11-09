import { useSyncExternalStore } from "react"

import { MAX_BODY_LENGTH } from "@kiwi/core/protocol.ts"
import { t } from "~/i18n/i18n"
import type { Upload, Where } from "~/model"

export const composerKey = (code: string, where: Where, inThread?: number): string => `${code}:${JSON.stringify(where)}:${inThread ?? ""}`

type Shelf = Pick<Storage, "getItem" | "setItem" | "removeItem">

const SAVED = "kiwi:drafts"

function shelf(): Shelf | null {
  try {
    return sessionStorage
  } catch {
    // No session storage (tests, a locked-down page): drafts last until the window reloads.
    return null
  }
}

function saved(on: Shelf | null): [string, string][] {
  try {
    const got: unknown = JSON.parse(on?.getItem(SAVED) ?? "{}")
    if (typeof got !== "object" || got === null) return []
    return Object.entries(got).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1].trim())
  } catch {
    // Junk in storage: start with no saved drafts.
    return []
  }
}

class Kept extends Map<string, string> {
  constructor(private readonly on: Shelf | null) {
    super(saved(on))
  }

  override set(key: string, text: string): this {
    super.set(key, text)
    this.save()
    return this
  }

  override delete(key: string): boolean {
    const had = super.delete(key)
    this.save()
    return had
  }

  private save(): void {
    if (!this.on) return
    const kept = [...this].filter(([, t]) => t.trim())
    try {
      if (kept.length) this.on.setItem(SAVED, JSON.stringify(Object.fromEntries(kept)))
      else this.on.removeItem(SAVED)
    } catch {
      // Storage full or off: the draft still lives in memory until the window reloads.
    }
  }
}

export const keptDrafts = (on: Shelf | null): Map<string, string> => new Kept(on)

export const drafts = keptDrafts(shelf())
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

export function tooLong(text: string): string | null {
  const over = text.length - MAX_BODY_LENGTH
  return over > 0 ? t("chat.drafts.too.long", { length: text.length, over, limit: MAX_BODY_LENGTH }) : null
}

export function backWords(why: string, placed: Placed, images: number): string {
  const lost = placed === "stash" && images ? (images === 1 ? t("chat.drafts.lost.image") : t("chat.drafts.lost.images", { count: images })) : ""
  return placed === "composer" ? t("chat.drafts.back.composer", { why }) : t("chat.drafts.back.stash", { why, lost })
}
