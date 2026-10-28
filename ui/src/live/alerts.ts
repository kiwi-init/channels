import { useEffect, useRef, useState } from "react"

import { bridge } from "@/lib/secrets"
import { ownPrefs } from "~/live/prefs"
import type { Ask } from "~/model"

const SOUND = "/sounds/needs-you.wav"
const GAP_MS = 5_000
const FRESH_MS = 60_000

let sound: HTMLAudioElement | null = null
let rang = 0

function chime(): void {
  if (ownPrefs().notify === "none") return
  const now = Date.now()
  if (now - rang < GAP_MS) return
  rang = now
  sound ??= new Audio(SOUND)
  sound.currentTime = 0
  void sound.play().catch(() => {})
}

export function show(title: string, body: string): void {
  const b = bridge()
  if (b) void b.notify(title, body).catch(() => {})
  else if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body, silent: true })
}

export function tellAsk(title: string, body: string): void {
  if (ownPrefs().notify === "none") return
  chime()
  show(title, body)
}

export function useAskChime(open: readonly Ask[]): void {
  const [since] = useState(() => Date.now() - FRESH_MS)
  const known = useRef(new Set<string>())
  useEffect(() => {
    const fresh = open.some((a) => !known.current.has(a.id) && a.at >= since)
    for (const a of open) known.current.add(a.id)
    if (fresh) chime()
  }, [open, since])
}
