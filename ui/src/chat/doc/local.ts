import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

export interface Shared {
  doc: Y.Doc
  awareness: Awareness
}

const kept = new Map<string, Shared>()

export function localDoc(key: string): Shared {
  const have = kept.get(key)
  if (have) return have
  const doc = new Y.Doc()
  const made = { doc, awareness: new Awareness(doc) }
  kept.set(key, made)
  return made
}
