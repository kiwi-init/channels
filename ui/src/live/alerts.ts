import { useEffect, useRef, useState } from "react"

import { ownPrefs } from "~/live/prefs"
import { silentNow } from "~/live/quiet"
import type { Ask } from "~/model"

const SOUND = "/sounds/needs-you.wav"
const GAP_MS = 5_000
const FRESH_MS = 60_000

let sound: HTMLAudioElement | null = null
let context: AudioContext | null = null
let decoded: Promise<AudioBuffer> | null = null
let rang = 0

const onLinux = (): boolean => document.documentElement.dataset.shell === "linux"

async function decode(into: AudioContext): Promise<AudioBuffer> {
  const bytes = await (await fetch(SOUND)).arrayBuffer()
  return into.decodeAudioData(bytes)
}

async function playDecoded(): Promise<void> {
  context ??= new AudioContext()
  decoded ??= decode(context).catch((e: unknown) => {
    decoded = null
    throw e
  })
  const buffer = await decoded
  await context.resume()
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
}

function playElement(): Promise<void> {
  sound ??= new Audio(SOUND)
  sound.currentTime = 0
  return sound.play()
}

export function chime(): void {
  const prefs = ownPrefs()
  if (prefs.notify === "none" || silentNow(prefs, Date.now())) return
  const now = Date.now()
  if (now - rang < GAP_MS) return
  rang = now
  void (onLinux() ? playDecoded() : playElement()).catch(() => {})
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
