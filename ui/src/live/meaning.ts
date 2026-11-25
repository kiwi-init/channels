import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"
import { useEffect, useSyncExternalStore } from "react"

export type MeaningItem = { id: number; from: string; where: string; text: string }
type MeaningOut = Awaited<ReturnType<KiwiBridge["searchMeaning"]>>
type KeyState = Awaited<ReturnType<KiwiBridge["typesafeKey"]>>
type KeySaved = Awaited<ReturnType<KiwiBridge["setTypesafeKey"]>>

const listeners = new Set<() => void>()
let key: KeyState | null = null
let asked = false

export const meaningCan = (): boolean => typeof bridge()?.searchMeaning === "function"

export async function searchMeaning(query: string, items: MeaningItem[]): Promise<MeaningOut> {
  try {
    const out = await bridge()!.searchMeaning({ query, items })
    if ("failed" in out && out.failed !== "unreachable") void loadKey()
    return out
  } catch {
    // An app that lost its main process for a moment: the row says Jev couldn't be reached.
    return { failed: "unreachable" }
  }
}

function told(next: KeyState): void {
  key = next
  for (const l of [...listeners]) l()
}

async function loadKey(): Promise<void> {
  const b = bridge()
  if (!b || typeof b.typesafeKey !== "function") return
  try {
    told(await b.typesafeKey())
  } catch {
    // No answer: the field stays as it was and asks again next time it shows.
    asked = false
  }
}

export function useTypesafeKey(): KeyState | null {
  const now = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => key
  )
  useEffect(() => {
    if (asked) return
    asked = true
    void loadKey()
  }, [])
  return now
}

export async function saveTypesafeKey(raw: string | null): Promise<KeySaved> {
  const out = await bridge()!.setTypesafeKey(raw)
  if (out.ok) told(out.key)
  return out
}
