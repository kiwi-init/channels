import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { agentBlock } from "@kiwi/core/doc/agent.ts"
import { blocksOf } from "@kiwi/core/doc/blocks.ts"
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts"
import { pipeDoc } from "@kiwi/core/doc/pipe.ts"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { changeBlock } from "~/chat/doc/change-block"

const QUICK = { wait: 1_000, linger: 0 }

interface Opened {
  thread: string
  th: string
  closed: boolean
}

function relay(doc: Y.Doc, opened: Opened[], fail?: string): (thread: string, th: string, on: (e: DocEvent) => void) => ReturnType<typeof heldPipe>["pipe"] {
  return (thread, th, on) => {
    const seen: Opened = { thread, th, closed: false }
    opened.push(seen)
    const { pipe, attach } = heldPipe()
    void Promise.resolve().then(() => {
      if (fail) return on({ _tag: "Failed", error: { kind: "other", message: fail } })
      on({ _tag: "Open", th })
      const real = pipeDoc(doc, new Awareness(doc), on)
      attach({
        ...real,
        close: () => {
          seen.closed = true
          real.close()
        },
      })
    })
    return pipe
  }
}

function said(doc: Y.Doc, text: string): string {
  const b = agentBlock(doc, "jow", "text")
  b.write(text)
  b.post()
  return b.id
}

const texts = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => b.text)
const settle = () => new Promise((done) => setTimeout(done, 10))

describe("the app's edit and delete reach the message's block in the doc (T1742)", () => {
  test("deleting a message takes its block out of the thread's doc, so a deleted secret isn't readable there", async () => {
    const doc = new Y.Doc()
    said(doc, "on it")
    const secret = said(doc, "the staging password is hunter2")
    const opened: Opened[] = []
    const docs = new Map([["task:7", "th7"]])
    expect(await changeBlock(relay(doc, opened), docs, { th: "th7", id: secret }, null, QUICK)).toBe(true)
    expect(texts(doc)).toEqual(["on it"])
    await settle()
    expect(opened).toEqual([{ thread: "task:7", th: "th7", closed: true }])
  })

  test("editing a message rewrites its block's text", async () => {
    const doc = new Y.Doc()
    const id = said(doc, "merged in #12")
    const opened: Opened[] = []
    expect(await changeBlock(relay(doc, opened), new Map([["main", "th1"]]), { th: "th1", id }, "merged in #13", QUICK)).toBe(true)
    expect(texts(doc)).toEqual(["merged in #13"])
  })

  test("a block in no known thread, a missing block or a doc that fails to open changes nothing and doesn't throw", async () => {
    const doc = new Y.Doc()
    const id = said(doc, "still here")
    const opened: Opened[] = []
    expect(await changeBlock(relay(doc, opened), new Map(), { th: "th1", id }, null, QUICK)).toBe(false)
    expect(opened).toEqual([])
    expect(await changeBlock(relay(doc, opened), new Map([["main", "th1"]]), { th: "th1", id: "nope" }, null, QUICK)).toBe(false)
    expect(await changeBlock(relay(doc, opened, "the channel was removed"), new Map([["main", "th1"]]), { th: "th1", id }, null, QUICK)).toBe(false)
    expect(texts(doc)).toEqual(["still here"])
  })
})
