import { useEffect } from "react"

import { loadMember } from "@kiwi/channel/store.ts"
import { linkOf } from "@kiwi/channel/channel-ops.ts"
import { bridge, type DeviceNewsView } from "@kiwi/secrets/secrets.ts"
import { announce } from "~/kit/toasts"
import { whileShown } from "~/live/shown"
import { store } from "~/live/value"

const POST_EVERY_MS = 30_000
const POST_HIDDEN_EVERY_MS = 600_000
const TOLD_KEY = "mc.devices.told"

export const deviceNews = store<DeviceNewsView | null>(null)

let kick: (() => void) | null = null

export const postDevicesNow = (): void => kick?.()

function told(): Set<string> {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(TOLD_KEY) ?? "[]")
    return new Set(Array.isArray(got) ? got.filter((x): x is string => typeof x === "string") : [])
  } catch {
    // Storage is off or the value is damaged: a notice may show once more, which is better than never.
    return new Set()
  }
}

function tell(news: DeviceNewsView): void {
  const seen = told()
  const fresh: string[] = []
  if (news.removed) {
    const key = `removed:${news.removed.by}`
    if (!seen.has(key)) {
      fresh.push(key)
      announce(
        news.removed.wiped
          ? `${news.removed.by} forgot this app, so it deleted its keys and the channels it joined. Channels it made stay`
          : `${news.removed.by} forgot this app. It keeps your person key, but it can't approve devices any more`
      )
    }
  }
  for (const r of news.revokes) {
    const key = `${r.device}:${r.at}`
    if (!r.older || seen.has(key)) continue
    fresh.push(key)
    announce(`${r.by} forgot ${r.label}, which you had longer. If that wasn't you, forget ${r.by}`)
  }
  if (!fresh.length) return
  try {
    localStorage.setItem(TOLD_KEY, JSON.stringify([...seen, ...fresh]))
  } catch {
    // Storage is off: the notice shows again next time, which is better than never.
  }
}

export function useDeviceLists(codes: readonly string[]): void {
  const key = codes.join(" ")
  useEffect(() => {
    let live = true
    const pass = async () => {
      const b = bridge()
      if (!b?.deviceNews) return
      const news = await b.deviceNews().catch(() => null)
      if (!live) return
      if (JSON.stringify(news) !== JSON.stringify(deviceNews.get())) deviceNews.set(news)
      if (!news) return
      tell(news)
      const codes = key ? key.split(" ") : []
      if (!codes.length) return
      const { postList } = await import("@kiwi/app/device-lists.ts")
      for (const code of codes) {
        const m = loadMember(code)
        if (m && live) await postList(code, news.links, linkOf(m)).catch(() => false)
      }
    }
    kick = () => void pass()
    void pass()
    const stop = whileShown(() => void pass(), POST_EVERY_MS, POST_HIDDEN_EVERY_MS)
    return () => {
      live = false
      kick = null
      stop()
    }
  }, [key])
}
