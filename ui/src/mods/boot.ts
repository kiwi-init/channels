import { bridge } from "@kiwi/secrets/secrets.ts"

const READY_MS = 20_000
const SETTLE_MS = 10_000

const booting = new Map<string, { name: string; hash: string; timer: ReturnType<typeof setTimeout> }>()
let settling = false

const firstLine = (s: string): string => (s.split("\n").find((l) => l.trim()) ?? "").trim()

function settleSoon(): void {
  if (booting.size || settling) return
  settling = true
  setTimeout(() => {
    const b = bridge()
    if (b && typeof b.modsSettled === "function") void b.modsSettled().catch(() => {})
  }, SETTLE_MS)
}

export function bootGone(frame: string): void {
  const was = booting.get(frame)
  if (!was) return
  clearTimeout(was.timer)
  booting.delete(frame)
  settleSoon()
}

export function bootFailed(frame: string, why: string): void {
  const was = booting.get(frame)
  if (!was) return
  bootGone(frame)
  const b = bridge()
  if (b && typeof b.modFailed === "function") void b.modFailed(was.name, was.hash, firstLine(why)).catch(() => {})
}

export function bootStarted(frame: string, name: string, hash: string): void {
  bootGone(frame)
  booting.set(frame, { name, hash, timer: setTimeout(() => bootFailed(frame, `it wasn't ready after ${READY_MS / 1000} seconds`), READY_MS) })
}
