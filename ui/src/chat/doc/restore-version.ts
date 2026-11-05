import { restoreThread } from "@kiwi/core/doc/blocks.ts"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { LiveDoc } from "~/chat/doc/live"

type OpenThreadDoc = (th: string, on: (e: DocEvent) => void) => PipeIn

const WAIT_MS = 15_000
const LINGER_MS = 5_000

export function restoreVersion(open: OpenThreadDoc, th: string, version: Uint8Array): Promise<boolean> {
  return new Promise((done) => {
    let failed = false
    let settled = false
    let late: ReturnType<typeof setTimeout> | null = null
    let off: (() => void) | null = null
    const live = new LiveDoc(
      (at, on) => open(at ?? th, on),
      th,
      () => void (failed = true)
    )
    const finish = (changed: boolean): void => {
      if (settled) return
      settled = true
      if (late) clearTimeout(late)
      off?.()
      setTimeout(() => live.destroy(), changed ? LINGER_MS : 0)
      done(changed)
    }
    const ready = (): void => finish(!failed && restoreThread(live.doc, version))
    if (live.isReady) return ready()
    late = setTimeout(() => finish(false), WAIT_MS)
    off = live.whenReady(ready)
  })
}
