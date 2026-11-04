import { removeBlock, rewriteBlock } from "@kiwi/core/doc/blocks.ts"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import type { DocBlockRef } from "@kiwi/core/protocol.ts"
import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { LiveDoc } from "~/chat/doc/live"

type OpenThreadDoc = (thread: string, th: string, on: (e: DocEvent) => void) => PipeIn

interface ChangeTimes {
  wait: number
  linger: number
}

const TIMES: ChangeTimes = { wait: 15_000, linger: 5_000 }

function threadOfBlock(docs: ReadonlyMap<string, string>, th: string): string | null {
  for (const [thread, id] of docs) if (id === th) return thread
  return null
}

export function changeBlock(open: OpenThreadDoc, docs: ReadonlyMap<string, string>, block: DocBlockRef, text: string | null, times: ChangeTimes = TIMES): Promise<boolean> {
  const thread = threadOfBlock(docs, block.th)
  if (!thread) return Promise.resolve(false)
  return new Promise((done) => {
    let failed = false
    let settled = false
    let late: ReturnType<typeof setTimeout> | null = null
    let off: (() => void) | null = null
    const live = new LiveDoc(
      (th, on) => open(thread, th ?? block.th, on),
      block.th,
      () => void (failed = true)
    )
    const finish = (changed: boolean, after: number): void => {
      if (settled) return
      settled = true
      if (late) clearTimeout(late)
      off?.()
      setTimeout(() => live.destroy(), after)
      done(changed)
    }
    const ready = (): void => {
      if (failed) return finish(false, 0)
      const changed = text === null ? removeBlock(live.doc, block.id) : rewriteBlock(live.doc, block.id, text)
      finish(changed, changed ? times.linger : 0)
    }
    if (live.isReady) return ready()
    late = setTimeout(() => finish(false, 0), times.wait)
    off = live.whenReady(ready)
  })
}
