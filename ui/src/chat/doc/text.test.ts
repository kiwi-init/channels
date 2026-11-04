import { describe, expect, test } from "bun:test"
import { blocksOf, threadText } from "@kiwi/core/doc/blocks.ts"
import { prosemirrorToYDoc } from "y-prosemirror"

import { FRAGMENT, fileNode, imageNode, schema } from "~/chat/doc/schema"

const T = 1_700_000_000_000
const { block, paragraph, mention, bullet_list, list_item, code_block } = schema.nodes

describe("what the editor writes, agents read", () => {
  test("a mention reads as @handle, marks drop away, lists and code keep their lines", () => {
    const doc = schema.nodes.doc.create(null, [
      block.create({ id: "AAAAAAAAAAAAAAAAAAAAAA", kind: "text", author: "jow", at: T }, [
        paragraph.create(null, [schema.text("ping "), mention.create({ name: "atlas" }), schema.text(" "), schema.text("now", [schema.marks.strong.create()])]),
        bullet_list.create(null, [list_item.create(null, paragraph.create(null, schema.text("one"))), list_item.create(null, paragraph.create(null, schema.text("two")))]),
        code_block.create(null, schema.text("bun test")),
      ]),
    ])
    const [only] = blocksOf(prosemirrorToYDoc(doc, FRAGMENT))
    expect(only?.author).toBe("jow")
    expect(only?.text).toBe("ping @atlas now\none\ntwo\nbun test")
  })

  test("the thread text names each block's author", () => {
    const doc = schema.nodes.doc.create(null, [
      block.create({ id: "AAAAAAAAAAAAAAAAAAAAAA", kind: "text", author: "jow", at: T }, paragraph.create(null, schema.text("hi"))),
      block.create({ id: "BBBBBBBBBBBBBBBBBBBBBB", kind: "agent", author: "atlas", at: T }, paragraph.create(null, schema.text("on it"))),
    ])
    expect(threadText(prosemirrorToYDoc(doc, FRAGMENT), (name) => name)).toBe("jow: hi\n\natlas (agent): on it")
  })

  test("an image or a file reads as its marker, and the doc holds only its reference, never its bytes", () => {
    const ref = { id: "a".repeat(64), key: "k".repeat(43), size: 84_000 }
    const doc = schema.nodes.doc.create(null, [
      block.create({ id: "AAAAAAAAAAAAAAAAAAAAAA", kind: "text", author: "jow", at: T }, [
        paragraph.create(null, schema.text("the bug:")),
        imageNode({ name: "shot.png", mime: "image/png", ref }),
        fileNode({ name: "trace.log", mime: "text/plain", size: 12, pieces: [{ id: "b".repeat(64), key: "j".repeat(43), size: 12 }] }),
      ]),
    ])
    const y = prosemirrorToYDoc(doc, FRAGMENT)
    expect(blocksOf(y)[0]?.text).toBe("the bug:\n[image: shot.png]\n[file: trace.log]")
    const xml = y.getXmlFragment(FRAGMENT).toString()
    expect(xml).toContain(ref.id)
    expect(xml.length).toBeLessThan(2_000)
  })
})
