import "~/i18n/en/chat-later"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

import { b64url, fromB64url } from "@kiwi/core/crypto.ts"
import { attachToBlock, blocksOf, markPosted, newBlock, removeBlock, type BlockMedia } from "@kiwi/core/doc/blocks.ts"
import { DOC_LEVEL, onWriterFloor, raiseWriterFloor, writerFloor } from "@kiwi/core/doc/level.ts"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import { mirrorAware } from "@kiwi/core/doc/pipe.ts"
import type { DocBlockRef } from "@kiwi/core/protocol.ts"
import type { DocEvent, WireError } from "../../../../desktop/src/bridge.ts"
import { filesOf, withoutPictures } from "~/chat/doc/files-of"
import { giveBackBlock } from "~/chat/doc/give-back"
import { madeHere, thisWindow, type MadeLines } from "~/chat/doc/made"
import { afterUploads, startUpload, uploading } from "~/chat/doc/uploads"
import { postFinished, type Finished, type Posting } from "~/chat/doc/post"
import { t } from "~/i18n/i18n"
import { noteTyping, tracingTyping } from "~/kit/typing-hook"
import type { BlockFiles } from "~/model"

export interface Shared {
  doc: Y.Doc
  awareness: Awareness
  made: MadeLines
}

export type OpenDoc = (th: string | null, on: (e: DocEvent) => void) => PipeIn

export type FindDoc = () => Promise<string | null>

export interface Poster {
  me: string
  post: (text: string, block: DocBlockRef, reply?: { re: number; quote?: string }, media?: BlockFiles) => Promise<boolean>
  posted?: (block: string) => boolean
}

interface Changed {
  added: number[]
  updated: number[]
  removed: number[]
}

const PIPE = Symbol("pipe")

export const docTag = (doc: Y.Doc): string => doc.guid.slice(0, 6)

function originOf(origin: unknown, phase: string): string | null {
  if (origin === PIPE) return phase
  if (origin instanceof Y.UndoManager) return "undo"
  if (origin === null || origin === undefined) return "app"
  return origin instanceof Object && "key" in origin && origin.key === "y-sync$" ? null : "other"
}

const said = (doc: Y.Doc): boolean => blocksOf(doc).some((b) => b.text.trim() !== "")

const whyNot = (e: WireError): string => (e.kind !== "gone" ? e.message : e.why === "removed" ? t("chat.doc.channel.removed") : t("chat.doc.channel.closed"))

export class LiveDoc implements Shared {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  readonly made: MadeLines = madeHere
  private pipe: PipeIn | null = null
  private current: object | null = null
  private opened: string | null = null
  private ready: boolean
  private dead = false
  private phase = "sync"
  private gaveUp = false
  private finding = false
  private checked = false
  private readonly moved = new Map<string, string>()
  private moveTo: { from: string; to: string } | null = null
  private readonly waiting = new Set<() => void>()
  private readonly unposted: { b: Finished; failed: () => void }[] = []
  private readonly posting: Posting | null
  private readonly floorOff: () => void

  constructor(
    private readonly open: OpenDoc,
    th: string | undefined,
    private readonly onFail: (why: string) => void,
    private readonly poster?: Poster,
    private readonly find?: FindDoc
  ) {
    this.ready = !th
    this.doc.on("update", this.onUpdate)
    this.doc.on("afterTransaction", this.onTransaction)
    this.awareness.on("change", this.onAware)
    this.posting = poster
      ? postFinished(
          this.doc,
          { me: poster.me, local: (origin) => origin !== PIPE, posted: poster.posted, owned: (b) => b.by === thisWindow || this.made.has(b.id), worked: this.made, hold: afterUploads },
          (b) => this.post(b)
        )
      : null
    this.floorOff = onWriterFloor(this.doc, this.holdFloor)
    if (th) this.connectKnown(th)
    else this.holdFloor()
  }

  get isReady(): boolean {
    return this.ready
  }

  whenReady(l: () => void): () => void {
    this.waiting.add(l)
    return () => void this.waiting.delete(l)
  }

  want(wanted: string | undefined): void {
    const th = wanted && (this.moved.get(wanted) ?? wanted)
    if (this.dead || !th || (this.pipe && this.opened === th)) return
    this.gaveUp = false
    this.connectKnown(th)
  }

  busy(): boolean {
    return blocksOf(this.doc).some((b) => uploading(b.id))
  }

  destroy(): void {
    this.dead = true
    this.posting?.stop()
    this.pipe?.close()
    this.pipe = null
    this.floorOff()
    this.doc.off("update", this.onUpdate)
    this.doc.off("afterTransaction", this.onTransaction)
    this.awareness.off("change", this.onAware)
    this.awareness.destroy()
    this.doc.destroy()
  }

  private connectKnown(th: string): void {
    this.connect(th)
    if (this.checked || !this.find) return
    this.checked = true
    this.find().then(
      (right) => {
        if (!right || right === th || this.dead) return
        this.moved.set(th, right)
        this.moveTo = { from: th, to: right }
        if (this.phase === "relay") this.move()
      },
      () => {
        this.checked = false
      }
    )
  }

  private move(): void {
    const to = this.moveTo
    if (!to || this.dead || this.opened !== to.from) return
    this.moveTo = null
    noteTyping(() => ({ what: "doc moved to the thread's first doc", origin: this.phase }))
    this.want(to.to)
  }

  private start(): void {
    if (this.finding) return
    if (!this.find) return this.connect(null)
    this.finding = true
    const go = (th: string | null): void => {
      this.finding = false
      if (this.dead || this.pipe || this.opened !== null) return
      this.connect(th)
    }
    this.find().then(go, () => go(null))
  }

  private connect(th: string | null): void {
    this.pipe?.close()
    this.pipe = null
    this.opened = th
    this.phase = this.phase === "reconnect" ? "reconnect" : "sync"
    noteTyping(() => ({ what: "doc pipe opened", origin: this.phase }))
    const token = {}
    this.current = token
    const pipe = this.open(th, (e) => {
      if (this.current === token && !this.dead) this.take(e)
    })
    if (this.current !== token) return pipe.close()
    this.pipe = pipe
    if (this.doc.store.clients.size) pipe.update(b64url(Y.encodeStateAsUpdate(this.doc)))
    pipe.aware(this.awareness.getLocalState())
  }

  private take(e: DocEvent): void {
    if (e._tag !== "Update" && e._tag !== "Aware") noteTyping(() => ({ what: `doc pipe: ${e._tag}`, origin: this.phase }))
    switch (e._tag) {
      case "Open":
        this.opened = e.th
        for (const u of this.unposted.splice(0)) this.post(u.b, u.failed)
        return
      case "Update":
        return Y.applyUpdate(this.doc, fromB64url(e.u), PIPE)
      case "Aware":
        return mirrorAware(this.awareness, e.u, PIPE)
      case "Ready":
        this.phase = "relay"
        this.isNowReady()
        return this.move()
      case "Down":
        this.phase = "reconnect"
        return this.connect(this.opened)
      case "Failed":
        this.current = null
        this.pipe = null
        this.gaveUp = true
        this.onFail(whyNot(e.error))
        for (const u of this.unposted.splice(0)) u.failed()
        return this.isNowReady()
    }
  }

  say(text: string, reply: { re: number; quote?: string } | null, back: (text: string) => void, media?: Promise<readonly BlockMedia[]>): boolean {
    if (!this.poster || this.gaveUp || this.dead || writerFloor(this.doc) > DOC_LEVEL) return false
    const { id } = newBlock(this.doc, "text", this.poster.me, text)
    markPosted(this.doc, id)
    const re = reply ? { re: reply.re, ...(reply.quote ? { quote: reply.quote } : {}) } : {}
    const failed = (): void => {
      removeBlock(this.doc, id)
      back(text)
    }
    if (!media) {
      this.post({ id, text, ...re }, failed)
      return true
    }
    const done = startUpload(id)
    media
      .then((m) => {
        attachToBlock(this.doc, id, m)
        this.post(
          {
            id,
            text:
              blocksOf(this.doc)
                .find((b) => b.id === id)
                ?.text.trim() ?? text,
            ...re,
          },
          failed
        )
      }, failed)
      .finally(done)
    return true
  }

  private post(b: Finished, failed: () => void = () => giveBackBlock(b.id)): void {
    if (!this.poster) return
    if (this.gaveUp) failed()
    else if (this.opened === null) this.unposted.push({ b, failed })
    else {
      const media = filesOf(this.doc, b.id)
      void this.poster
        .post(
          withoutPictures(b.text, media.imgs),
          { th: this.opened, id: b.id },
          b.re ? { re: b.re, ...(b.quote ? { quote: b.quote } : {}) } : undefined,
          media.imgs.length || media.files.length ? media : undefined
        )
        .then((went) => {
          if (!went) failed()
        })
    }
  }

  private readonly holdFloor = (): void => {
    if (!this.dead && this.ready && !this.gaveUp) raiseWriterFloor(this.doc, DOC_LEVEL)
  }

  private isNowReady(): void {
    if (this.ready) return
    this.ready = true
    this.holdFloor()
    for (const l of [...this.waiting]) l()
  }

  private readonly onUpdate = (u: Uint8Array, origin: unknown): void => {
    if (origin === PIPE || this.dead) return
    if (this.pipe) this.pipe.update(b64url(u))
    else if (!this.gaveUp && this.opened === null && said(this.doc)) this.start()
  }

  private readonly onTransaction = (tr: Y.Transaction): void => {
    if (!tracingTyping() || (tr.changed.size === 0 && tr.deleteSet.clients.size === 0)) return
    const origin = originOf(tr.origin, this.phase)
    if (origin) noteTyping(() => ({ what: "doc changed", origin, count: tr.changed.size, doc: docTag(this.doc) }))
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
      const drop = (): void => {
        if (k.users > 0 || kept.get(key) !== k) return
        if (k.live.busy()) return void (k.timer = setTimeout(drop, KEEP_MS))
        kept.delete(key)
        k.live.destroy()
      }
      k.timer = setTimeout(drop, KEEP_MS)
    },
  }
}
