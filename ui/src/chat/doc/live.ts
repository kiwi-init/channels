import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

import { b64url, fromB64url } from "@kiwi/core/crypto.ts"
import { blocksOf } from "@kiwi/core/doc/blocks.ts"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import { mirrorAware } from "@kiwi/core/doc/pipe.ts"
import type { DocBlockRef } from "@kiwi/core/protocol.ts"
import type { DocEvent, WireError } from "../../../../desktop/src/bridge.ts"
import { postFinished, type Finished, type Posting } from "~/chat/doc/post"
import { FRAGMENT } from "~/chat/doc/schema"

export interface Shared {
  doc: Y.Doc
  awareness: Awareness
}

export type OpenDoc = (th: string | null, on: (e: DocEvent) => void) => PipeIn

export interface Poster {
  me: string
  post: (text: string, block: DocBlockRef) => Promise<boolean>
  posted?: (block: string) => boolean
}

interface Changed {
  added: number[]
  updated: number[]
  removed: number[]
}

const PIPE = Symbol("pipe")

const said = (doc: Y.Doc): boolean => blocksOf(doc).some((b) => b.text.trim() !== "")

const whyNot = (e: WireError): string => (e.kind === "gone" ? `the channel was ${e.why}` : e.message)

export class LiveDoc implements Shared {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  private pipe: PipeIn | null = null
  private current: object | null = null
  private opened: string | null = null
  private ready: boolean
  private dead = false
  private gaveUp = false
  private readonly waiting = new Set<() => void>()
  private readonly unposted: Finished[] = []
  private readonly posting: Posting | null

  constructor(
    private readonly open: OpenDoc,
    th: string | undefined,
    private readonly onFail: (why: string) => void,
    private readonly poster?: Poster
  ) {
    this.ready = !th
    this.doc.on("update", this.onUpdate)
    this.awareness.on("change", this.onAware)
    this.posting = poster ? postFinished(this.doc, { me: poster.me, local: (origin) => origin !== PIPE, posted: poster.posted }, (b) => this.post(b)) : null
    if (th) this.connect(th)
  }

  get isReady(): boolean {
    return this.ready
  }

  whenReady(l: () => void): () => void {
    this.waiting.add(l)
    return () => void this.waiting.delete(l)
  }

  want(th: string | undefined): void {
    if (this.dead || !th || (this.pipe && this.opened === th)) return
    this.gaveUp = false
    this.connect(th)
  }

  destroy(): void {
    this.dead = true
    this.posting?.stop()
    this.pipe?.close()
    this.pipe = null
    this.doc.off("update", this.onUpdate)
    this.awareness.off("change", this.onAware)
    this.awareness.destroy()
    this.doc.destroy()
  }

  private connect(th: string | null): void {
    this.pipe?.close()
    this.pipe = null
    this.opened = th
    const token = {}
    this.current = token
    const pipe = this.open(th, (e) => {
      if (this.current === token && !this.dead) this.take(e)
    })
    if (this.current !== token) return pipe.close()
    this.pipe = pipe
    if (this.doc.getXmlFragment(FRAGMENT).length) pipe.update(b64url(Y.encodeStateAsUpdate(this.doc)))
    pipe.aware(this.awareness.getLocalState())
  }

  private take(e: DocEvent): void {
    switch (e._tag) {
      case "Open":
        this.opened = e.th
        for (const b of this.unposted.splice(0)) this.post(b)
        return
      case "Update":
        return Y.applyUpdate(this.doc, fromB64url(e.u), PIPE)
      case "Aware":
        return mirrorAware(this.awareness, e.u, PIPE)
      case "Ready":
        return this.isNowReady()
      case "Down":
        return this.connect(this.opened)
      case "Failed":
        this.current = null
        this.pipe = null
        this.gaveUp = true
        this.onFail(whyNot(e.error))
        return this.isNowReady()
    }
  }

  private post(b: Finished): void {
    if (!this.poster) return
    if (this.opened === null) this.unposted.push(b)
    else
      void this.poster.post(b.text, { th: this.opened, id: b.id }).then((went) => {
        if (!went) this.posting?.giveBack(b.id)
      })
  }

  private isNowReady(): void {
    if (this.ready) return
    this.ready = true
    for (const l of [...this.waiting]) l()
  }

  private readonly onUpdate = (u: Uint8Array, origin: unknown): void => {
    if (origin === PIPE || this.dead) return
    if (this.pipe) this.pipe.update(b64url(u))
    else if (!this.gaveUp && this.opened === null && said(this.doc)) this.connect(null)
  }

  private readonly onAware = (_: Changed, origin: unknown): void => {
    if (origin === "local") this.pipe?.aware(this.awareness.getLocalState())
  }
}

const KEEP_MS = 60_000

interface Kept {
  live: LiveDoc
  users: number
  timer: ReturnType<typeof setTimeout> | null
}

const kept = new Map<string, Kept>()

export function holdDoc(key: string, make: () => LiveDoc): { live: LiveDoc; release: () => void } {
  const had = kept.get(key)
  const k: Kept = had ?? { live: make(), users: 0, timer: null }
  if (k.timer) clearTimeout(k.timer)
  k.timer = null
  k.users++
  kept.set(key, k)
  let done = false
  return {
    live: k.live,
    release: () => {
      if (done) return
      done = true
      if (--k.users > 0) return
      k.timer = setTimeout(() => {
        if (k.users > 0 || kept.get(key) !== k) return
        kept.delete(key)
        k.live.destroy()
      }, KEEP_MS)
    },
  }
}
