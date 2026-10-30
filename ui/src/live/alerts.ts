import { useEffect, useRef, useState } from "react"

import { ownPrefs } from "~/live/prefs"
import type { Ask } from "~/model"

const SOUND = "/sounds/needs-you.wav"
const GAP_MS = 5_000
const FRESH_MS = 60_000

type Decoded = { context: AudioContext; buffer: AudioBuffer }

let sound: HTMLAudioElement | null = null
let decoded: Promise<Decoded> | null = null
let rang = 0

const onLinux = (): boolean => document.documentElement.dataset.shell === "linux"

async function decode(): Promise<Decoded> {
  const bytes = await (await fetch(SOUND)).arrayBuffer()
  const context = new AudioContext()
  return { context, buffer: await context.decodeAudioData(bytes) }
}

async function playDecoded(): Promise<void> {
  decoded ??= decode().catch((e: unknown) => {
    decoded = null
    throw e
  })
  const { context, buffer } = await decoded
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
  if (ownPrefs().notify === "none") return
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
