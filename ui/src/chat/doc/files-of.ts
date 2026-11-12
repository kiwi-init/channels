import type * as Y from "yjs"

import { mediaOfBlock } from "@kiwi/core/doc/blocks.ts"

import type { BlockFiles } from "~/model"

export function withoutPictures(text: string, imgs: BlockFiles["imgs"]): string {
  const lines = text.split("\n")
  for (const i of imgs) {
    const at = lines.indexOf(`[image: ${i.name}]`)
    if (at >= 0) lines.splice(at, 1)
  }
  return lines.join("\n").trim()
}

export function filesOf(doc: Y.Doc, block: string): BlockFiles {
  const { imgs, files } = mediaOfBlock(doc, block)
  return { imgs: imgs.flatMap((i) => (i.ref ? [{ name: i.name, mime: i.mime, ref: i.ref }] : [])), files }
}
