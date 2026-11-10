import { originalBlob } from "~/chat/originals"
import { shrink, type ShrinkAsk, type ShrinkReply } from "~/chat/thumb-shrink"

export const FEED_BOX = 360
export const DOC_BOX = 480
const SPARE = 32
const WORKER_WAIT_MS = 15_000
const WORKER_IDLE_MS = 5_000

export interface Shot {
  width: number
  height: number
  thumb: string | null
}

export const scaleFor = (ratio: number): number => Math.max(2, Math.ceil(ratio))

export function thumbSize(width: number, height: number, box: number, scale: number): { width: number; height: number } | null {
  const want = Math.round(box * scale)
  if (width <= want) return null
  return { width: want, height: Math.max(1, Math.round((height * want) / width)) }
}

export const keyOf = (id: string, box: number, scale: number): string => `${id}@${box}x${scale}`

interface Held {
  wait: Promise<Shot>
  shot: Shot | null
  users: number
}

export class Thumbs {
  private readonly held = new Map<string, Held>()
  private readonly idle = new Set<string>()

  constructor(
    private readonly make: (url: string, box: number, scale: number) => Promise<Shot>,
    private readonly spare: number
  ) {}

  peek(key: string): Shot | null {
    return this.held.get(key)?.shot ?? null
  }

  warm(key: string, url: string, box: number, scale: number): Promise<Shot> {
    const was = this.held.get(key)
    if (was) return was.wait
    const made = this.make(url, box, scale)
    const held: Held = { wait: made, shot: null, users: 0 }
    held.wait = made.then(
      (shot) => {
        if (this.held.get(key) === held) held.shot = shot
        return shot
      },
      (err: unknown) => {
        if (this.held.get(key) === held) {
          this.held.delete(key)
          this.idle.delete(key)
        }
        throw err
      }
    )
    this.held.set(key, held)
    this.idle.add(key)
    this.trim()
    return held.wait
  }

  take(key: string, url: string, box: number, scale: number): Promise<Shot> {
    const wait = this.warm(key, url, box, scale)
    const held = this.held.get(key)
    if (held) {
      held.users++
      this.idle.delete(key)
    }
    return wait
  }

  free(key: string): void {
    const held = this.held.get(key)
    if (!held || held.users === 0) return
    held.users--
    if (held.users > 0) return
    this.idle.add(key)
    this.trim()
  }

  private trim(): void {
    for (const key of this.idle) {
      if (this.idle.size <= this.spare) return
      this.idle.delete(key)
      this.held.delete(key)
    }
  }
}

let worker: Worker | null = null
let broken = false
let asked = 0
let rest = 0
const waiting = new Map<number, (reply: ShrinkReply) => void>()

function stopWorker(): void {
  worker?.terminate()
  worker = null
  for (const [id, done] of waiting) done({ id, failed: "the worker stopped" })
  waiting.clear()
}

function startWorker(): Worker | null {
  if (broken || typeof Worker === "undefined") return null
  if (worker) return worker
  try {
    worker = new Worker(new URL("./thumb-worker.ts", import.meta.url), { type: "module" })
  } catch {
    // This page can't start a worker (an old engine, or its policy): the copies are made on the page's own thread.
    broken = true
    return null
  }
  worker.addEventListener("message", (e: MessageEvent<ShrinkReply>) => {
    waiting.get(e.data.id)?.(e.data)
    waiting.delete(e.data.id)
  })
  worker.addEventListener("error", () => {
    broken = true
    stopWorker()
  })
  return worker
}

function inWorker(url: string, width: number, height: number): Promise<string | null> {
  const to = startWorker()
  if (!to) return Promise.reject(new Error("no worker"))
  window.clearTimeout(rest)
  const id = ++asked
  return new Promise<string | null>((done, fail) => {
    const late = window.setTimeout(() => {
      broken = true
      stopWorker()
    }, WORKER_WAIT_MS)
    waiting.set(id, (reply) => {
      window.clearTimeout(late)
      if (!waiting.size || (waiting.size === 1 && waiting.has(id))) rest = window.setTimeout(stopWorker, WORKER_IDLE_MS)
      if ("failed" in reply) fail(new Error(reply.failed))
      else done(reply.thumb)
    })
    const blob = originalBlob(url)
    const ask: ShrinkAsk = { id, url: blob ? "" : url, width, height, ...(blob ? { blob } : {}) }
    to.postMessage(ask)
  })
}

let line: Promise<unknown> = Promise.resolve()

function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = line.then(job, job)
  line = run.catch(() => undefined)
  return run
}

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((done, fail) => {
    const el = new window.Image()
    el.onload = () => done({ width: el.naturalWidth, height: el.naturalHeight })
    el.onerror = () => fail(new Error("the image couldn't be read"))
    el.src = url
  })
}

async function shoot(url: string, box: number, scale: number): Promise<Shot> {
  const natural = await measure(url)
  const size = thumbSize(natural.width, natural.height, box, scale)
  if (!size) return { ...natural, thumb: null }
  const thumb = await inTurn(async () => {
    try {
      return await inWorker(url, size.width, size.height)
    } catch {
      // The worker couldn't make this copy: the page makes it, and if the page can, the worker's engine lacks something, so it isn't asked again.
      const made = await shrink(url, size.width, size.height, originalBlob(url))
      broken = true
      stopWorker()
      return made
    }
  }).catch(() => null)
  return { ...natural, thumb }
}

export const thumbs = new Thumbs(shoot, SPARE)

export function warmFor(id: string, url: string, box: number): Promise<Shot> {
  const scale = scaleFor(window.devicePixelRatio)
  return thumbs.warm(keyOf(id, box, scale), url, box, scale)
}
