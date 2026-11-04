import * as Y from "yjs"
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness"

import type { Node } from "prosemirror-model"
import { prosemirrorToYXmlFragment } from "y-prosemirror"

import { demoDoc } from "~/demo/doc-hub"
import { DEMO_CHART, DEMO_REPORT } from "~/demo/doc-media"
import { FRAGMENT, fileNode, imageNode, newBlockId, schema, type BlockKind } from "~/chat/doc/schema"

interface Seed {
  kind: BlockKind
  author: string
  ago: number
  body: Node[]
}

const { paragraph, mention, bullet_list, list_item, code_block } = schema.nodes
const line = (...parts: (string | Node)[]): Node =>
  paragraph.create(
    null,
    parts.map((p) => (typeof p === "string" ? schema.text(p) : p))
  )
const bold = (text: string): Node => schema.text(text, [schema.marks.strong.create()])
const code = (text: string): Node => schema.text(text, [schema.marks.code.create()])

const SEEDS: readonly Seed[] = [
  {
    kind: "agent",
    author: "win",
    ago: 6,
    body: [
      line("Icons are a sprite now: ", bold("9 KB"), ", down from 31. Markdown is the last big chunk in the first load."),
      code_block.create(null, schema.text("bun scripts/ui-bundle.ts\nfirst-load JS: 741,425 bytes (budget 760,000)")),
      imageNode(DEMO_CHART),
      fileNode(DEMO_REPORT),
    ],
  },
  { kind: "text", author: "jow", ago: 4, body: [line("Keep markdown in the first load if it stays under 30 KB, people see it on every open.")] },
  {
    kind: "agent",
    author: "atlas",
    ago: 1,
    body: [
      line("Measuring markdown alone: 27 KB gzipped. It can stay."),
      bullet_list.create(null, [list_item.create(null, line("markdown stays in the first load")), list_item.create(null, line("mermaid stays lazy, behind ", code("kit/later.ts")))]),
    ],
  },
  { kind: "text", author: "jow", ago: 0, body: [line(mention.create({ name: "win" }), " can you put both numbers on the PR?")] },
]

const AUTHORS = ["win", "atlas", "maya", "jow", "pixel"] as const
const WORDS = "the bundle shrinks when icons share one sprite and markdown loads after the first paint so people see the thread at once".split(" ")

function filler(n: number): Seed[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: i % 7 === 3 ? "tool" : i % 2 ? "agent" : "text",
    author: AUTHORS[i % AUTHORS.length] ?? "win",
    ago: 60 * 24 - i,
    body: Array.from({ length: 1 + (i % 3) }, (_l, j) => line(WORDS.slice((i + j) % 9, ((i + j) % 9) + 6 + (i % 12)).join(" "))),
  }))
}

function block(seed: Seed): Node {
  return schema.nodes.block.create({ id: newBlockId(), kind: seed.kind, author: seed.author, at: Date.now() - seed.ago * 60_000 }, seed.body)
}

function peer(main: Y.Doc, aware: Awareness, name: string, color: string): { doc: Y.Doc; awareness: Awareness } {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(main))
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== main) Y.applyUpdate(main, u, doc)
  })
  main.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== doc) Y.applyUpdate(doc, u, main)
  })
  const awareness = new Awareness(doc)
  awareness.on("update", ({ added, updated }: { added: number[]; updated: number[] }) => applyAwarenessUpdate(aware, encodeAwarenessUpdate(awareness, [...added, ...updated]), doc))
  awareness.setLocalStateField("user", { name, color })
  return { doc, awareness }
}

function textIn(doc: Y.Doc, at: number): Y.XmlText | null {
  const b = doc.getXmlFragment(FRAGMENT).get(at)
  const p = b instanceof Y.XmlElement ? b.get(0) : null
  const t = p instanceof Y.XmlElement ? p.get(0) : null
  return t instanceof Y.XmlText ? t : null
}

function point(awareness: Awareness, text: Y.XmlText, from: number, to: number): void {
  awareness.setLocalStateField("cursor", {
    anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from)),
    head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to)),
  })
}

export function seedThreadDoc(code: string, thread: string, extra: number): void {
  const { doc, awareness } = demoDoc(code, thread)
  const frag = doc.getXmlFragment(FRAGMENT)
  if (frag.length > 0) return
  prosemirrorToYXmlFragment(schema.nodes.doc.create(null, [...filler(extra), ...SEEDS].map(block)), frag)
  const atlas = peer(doc, awareness, "atlas", "orange")
  const maya = peer(doc, awareness, "maya", "pink")
  const base = frag.length - SEEDS.length
  const said = textIn(atlas.doc, base + 1)
  const typing = textIn(maya.doc, base + 2)
  const phrase = said?.toString().indexOf("under 30 KB") ?? -1
  if (said && phrase >= 0) point(atlas.awareness, said, phrase, phrase + "under 30 KB".length)
  if (typing) point(maya.awareness, typing, typing.length, typing.length)
}
