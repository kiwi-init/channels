import type * as Y from "yjs"

import { mediaOfBlock } from "@kiwi/core/doc/blocks.ts"

import type { BlockFiles } from "~/model"

export function filesOf(doc: Y.Doc, block: string): BlockFiles {
  const { imgs, files } = mediaOfBlock(doc, block)
  return { imgs: imgs.flatMap((i) => (i.ref ? [{ name: i.name, mime: i.mime, ref: i.ref }] : [])), files }
}
