import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness"
import { b64url } from "@kiwi/core/crypto.ts"
import { blocksOf } from "@kiwi/core/doc/blocks.ts"
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts"
import { DOC_LEVEL, raiseWriterFloor, writerFloor } from "@kiwi/core/doc/level.ts"
import { pipeDoc } from "@kiwi/core/doc/pipe.ts"
import { prosemirrorToYXmlFragment } from "y-prosemirror"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { LiveDoc, type OpenDoc } from "~/chat/doc/live"
import { FRAGMENT, schema } from "~/chat/doc/schema"

const T = 1_700_000_000_000
const tick = () => new Promise((done) => setTimeout(done, 0))

interface Host {
  doc: Y.Doc
  awareness: Awareness
}

function host(): Host {
  const doc = new Y.Doc()
  return { doc, awareness: new Awareness(doc) }
}

function write(doc: Y.Doc, author: string, text: string): void {
  const frag = doc.getXmlFragment(FRAGMENT)
  const at = frag.length
  const block = schema.nodes.block.create({ id: `${author}${at}`.padEnd(22, "A"), kind: "text", author, at: T }, schema.nodes.paragraph.create(null, text ? schema.text(text) : null))
  const scratch = new Y.Doc()
  prosemirrorToYXmlFragment(schema.nodes.doc.create(null, [block]), scratch.getXmlFragment(FRAGMENT))
  const made = scratch.getXmlFragment(FRAGMENT).get(0)
  if (!(made instanceof Y.XmlElement)) throw new Error("no block")
  frag.insert(at, [made.clone()])
}

const texts = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => b.text)

function relay(hosts: Map<string, Host>, opened: (string | null)[]): OpenDoc {
  return (th, on) => {
    opened.push(th)
    const id = th ?? "fresh"
    const h = hosts.get(id) ?? host()
    hosts.set(id, h)
    const { pipe, attach } = heldPipe()
    void Promise.resolve().then(() => {
      on({ _tag: "Open", th: id })
      attach(pipeDoc(h.doc, h.awareness, on))
    })
    return pipe
  }
}

describe("the editor's doc mirrors the channel's live doc", () => {
  test("an open doc shows once it has synced, and edits flow both ways without echoes", async () => {
    const h = host()
    write(h.doc, "atlas", "on it")
    const hosts = new Map([["th1", h]])
    const opened: (string | null)[] = []
    const live = new LiveDoc(relay(hosts, opened), "th1", () => {})
    expect(live.isReady).toBe(false)
    let ready = 0
    live.whenReady(() => ready++)
    await tick()
    expect(live.isReady).toBe(true)
    expect(ready).toBe(1)
    expect(texts(live.doc)).toEqual(["on it"])

    let hostUpdates = 0
    h.doc.on("update", () => hostUpdates++)
    write(live.doc, "jow", "thanks")
    expect(texts(h.doc)).toEqual(["on it", "thanks"])
    expect(hostUpdates).toBe(1)

    let mirrorUpdates = 0
    live.doc.on("update", () => mirrorUpdates++)
    write(h.doc, "atlas", "merged")
    expect(texts(live.doc)).toEqual(["on it", "thanks", "merged"])
    expect(mirrorUpdates).toBe(1)
    expect(opened).toEqual(["th1"])
    live.destroy()
  })

  test("the pipe never sends an edit back to where it came from", async () => {
    const h = host()
    const out: DocEvent[] = []
    const p = pipeDoc(h.doc, h.awareness, (e) => out.push(e))
    await tick()
    expect(out.map((e) => e._tag)).toEqual(["Update", "Ready"])
    out.length = 0
    const typed = new Y.Doc()
    write(typed, "jow", "from the editor")
    p.update(b64url(Y.encodeStateAsUpdate(typed)))
    p.aware({ user: { name: "jow" } })
    expect(texts(h.doc)).toEqual(["from the editor"])
    expect(out).toEqual([])
    write(h.doc, "atlas", "from the relay")
    expect(out.map((e) => e._tag)).toEqual(["Update"])
    p.close()
    write(h.doc, "atlas", "after close")
    expect(out).toHaveLength(1)
    expect(h.awareness.getLocalState()).toBeNull()
  })

  test("a thread with no doc yet starts one only when someone types words", async () => {
    const hosts = new Map<string, Host>()
    const opened: (string | null)[] = []
    const live = new LiveDoc(relay(hosts, opened), undefined, () => {})
    expect(live.isReady).toBe(true)
    write(live.doc, "jow", "")
    expect(opened).toEqual([])
    write(live.doc, "jow", "first words")
    expect(opened).toEqual([null])
    await tick()
    expect(texts(hosts.get("fresh")?.doc ?? new Y.Doc())).toEqual(["", "first words"])

    live.want("fresh")
    expect(opened).toEqual([null])
    live.destroy()
  })

  test("when another doc won the thread, the words move into it", async () => {
    const winner = host()
    write(winner.doc, "maya", "mine was first")
    const hosts = new Map([["won", winner]])
    const opened: (string | null)[] = []
    const live = new LiveDoc(relay(hosts, opened), undefined, () => {})
    write(live.doc, "jow", "racing")
    await tick()
    live.want("won")
    await tick()
    expect(opened).toEqual([null, "won"])
    expect(texts(winner.doc).sort()).toEqual(["mine was first", "racing"])
    expect(texts(live.doc).sort()).toEqual(["mine was first", "racing"])
    live.destroy()
  })

  test("your cursor becomes the live doc's own; others' cursors come back, yours never echoes", async () => {
    const h = host()
    const hosts = new Map([["th1", h]])
    const live = new LiveDoc(relay(hosts, []), "th1", () => {})
    await tick()
    live.awareness.setLocalStateField("user", { name: "jow", color: "blue" })
    expect(h.awareness.getLocalState()).toEqual({ user: { name: "jow", color: "blue" } })
    expect(live.awareness.getStates().has(h.awareness.clientID)).toBe(false)

    const peer = new Awareness(new Y.Doc())
    peer.setLocalStateField("user", { name: "atlas", color: "orange" })
    applyAwarenessUpdate(h.awareness, encodeAwarenessUpdate(peer, [peer.clientID]), "remote")
    expect(live.awareness.getStates().get(peer.clientID)).toEqual({ user: { name: "atlas", color: "orange" } })
    peer.destroy()
    live.destroy()
  })

  test("a pipe that answers at once works the same", async () => {
    const h = host()
    write(h.doc, "atlas", "already here")
    const live = new LiveDoc(
      (th, on) => {
        on({ _tag: "Open", th: th ?? "now" })
        return pipeDoc(h.doc, h.awareness, on)
      },
      "now",
      () => {}
    )
    expect(live.isReady).toBe(false)
    await tick()
    expect(live.isReady).toBe(true)
    write(live.doc, "jow", "typed")
    expect(texts(h.doc)).toEqual(["already here", "typed"])
    const failing = new LiveDoc(
      (_th, on) => {
        on({ _tag: "Failed", error: { kind: "gone", why: "removed" } })
        return heldPipe().pipe
      },
      "gone",
      () => {}
    )
    expect(failing.isReady).toBe(true)
    live.destroy()
    failing.destroy()
  })

  test("a doc that can't open says why once and stays a local draft", async () => {
    const fails: string[] = []
    let asked = 0
    const open: OpenDoc = (_th, on: (e: DocEvent) => void) => {
      asked++
      const { pipe } = heldPipe()
      void Promise.resolve().then(() => on({ _tag: "Failed", error: { kind: "other", message: "no key for room r1 on this computer" } }))
      return pipe
    }
    const live = new LiveDoc(open, undefined, (why) => fails.push(why))
    write(live.doc, "jow", "hello")
    await tick()
    write(live.doc, "jow", "again")
    expect(asked).toBe(1)
    expect(fails).toEqual(["no key for room r1 on this computer"])
    live.destroy()
  })

  test("a synced copy raises the doc's writer floor to its own level, and never lowers a newer one (T2558)", async () => {
    const h = host()
    write(h.doc, "atlas", "on it")
    const newer = host()
    raiseWriterFloor(newer.doc, DOC_LEVEL + 1)
    const hosts = new Map([
      ["th1", h],
      ["th2", newer],
    ])
    const live = new LiveDoc(relay(hosts, []), "th1", () => {})
    expect(writerFloor(h.doc)).toBe(0)
    await tick()
    expect(writerFloor(h.doc)).toBe(DOC_LEVEL)
    const behind = new LiveDoc(relay(hosts, []), "th2", () => {})
    await tick()
    expect(writerFloor(newer.doc)).toBe(DOC_LEVEL + 1)
    expect(writerFloor(behind.doc)).toBeGreaterThan(DOC_LEVEL)
    live.destroy()
    behind.destroy()
  })
})
