import * as Y from "yjs"
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness"

import { localDoc } from "~/chat/doc/local"
import { FRAGMENT, newBlockId, type BlockKind } from "~/chat/doc/schema"

interface Seed {
  kind: BlockKind
  author: string
  ago: number
  lines: string[]
}

const SEEDS: readonly Seed[] = [
  { kind: "agent", author: "win", ago: 6, lines: ["Icons are a sprite now: 9 KB, down from 31.", "Markdown is the last big chunk in the first load."] },
  { kind: "text", author: "jow", ago: 4, lines: ["Keep markdown in the first load if it stays under 30 KB, people see it on every open."] },
  { kind: "agent", author: "atlas", ago: 1, lines: ["Measuring markdown alone: 27 KB gzipped. It can stay."] },
]

function block(seed: Seed): Y.XmlElement {
  const el = new Y.XmlElement("block")
  el.setAttribute("id", newBlockId())
  el.setAttribute("kind", seed.kind)
  el.setAttribute("author", seed.author)
  el.setAttribute("at", String(Date.now() - seed.ago * 60_000))
  el.insert(
    0,
    seed.lines.map((line) => {
      const p = new Y.XmlElement("paragraph")
      p.insert(0, [new Y.XmlText(line)])
      return p
    })
  )
  return el
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

export function seedThreadDoc(key: string): void {
  const { doc, awareness } = localDoc(key)
  const frag = doc.getXmlFragment(FRAGMENT)
  if (frag.length > 0) return
  frag.insert(0, SEEDS.map(block))
  const atlas = peer(doc, awareness, "atlas", "orange")
  const maya = peer(doc, awareness, "maya", "pink")
  const said = textIn(atlas.doc, 1)
  const typing = textIn(maya.doc, 2)
  const phrase = said?.toString().indexOf("under 30 KB") ?? -1
  if (said && phrase >= 0) point(atlas.awareness, said, phrase, phrase + "under 30 KB".length)
  if (typing) point(maya.awareness, typing, typing.length, typing.length)
}
