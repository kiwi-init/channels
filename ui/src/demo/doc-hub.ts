import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import { pipeDoc } from "@kiwi/core/doc/pipe.ts"
import type { DocEvent } from "../../../desktop/src/bridge.ts"

interface Hosted {
  doc: Y.Doc
  awareness: Awareness
}

const hosted = new Map<string, Hosted>()

export function demoDoc(code: string, thread: string): Hosted {
  const key = `${code}\n${thread}`
  const had = hosted.get(key)
  if (had) return had
  const doc = new Y.Doc()
  const made = { doc, awareness: new Awareness(doc) }
  hosted.set(key, made)
  return made
}

export function demoDocs(code: string): Record<string, string> {
  const here = [...hosted.keys()].flatMap((key) => (key.startsWith(`${code}\n`) ? [key.slice(code.length + 1)] : []))
  return Object.fromEntries(here.map((thread) => [thread, `demo-${thread}`]))
}

export function openDemoDoc(code: string, thread: string, th: string | null, on: (e: DocEvent) => void): PipeIn {
  const { doc, awareness } = demoDoc(code, thread)
  on({ _tag: "Open", th: th ?? `demo-${thread}` })
  return pipeDoc(doc, awareness, on)
}
