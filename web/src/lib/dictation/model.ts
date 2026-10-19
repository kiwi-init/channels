import { DICTATION_BYTES, DICTATION_FILES, DICTATION_PATH, sha256Hex } from "@kiwi/core/dictation.ts"

export const CACHE_NAME = "kiwi-dictation-1"

const OLD_CACHES = /^kiwi-dictation-\d+$/

export class DictationProblem extends Error {}

const keyOf = (name: string) => `https://dictation.kiwi.invalid/${DICTATION_FILES[name]!.sha256}/${name}`

export async function cachedFile(name: string): Promise<ArrayBuffer | null> {
  if (!DICTATION_FILES[name]) return null
  const hit = await (await caches.open(CACHE_NAME)).match(keyOf(name))
  return hit ? hit.arrayBuffer() : null
}

export async function modelReady(): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME)
  const kept = await Promise.all(Object.keys(DICTATION_FILES).map((name) => cache.match(keyOf(name))))
  return kept.every(Boolean)
}

async function said(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).trim()
  return text || `The relay answered ${res.status}.`
}

async function readAll(res: Response, onBytes: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(await res.arrayBuffer())
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    total += value.byteLength
    onBytes(value.byteLength)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

export async function downloadModel(relay: string, onProgress: (fraction: number) => void, fetcher: typeof fetch = fetch): Promise<void> {
  for (const name of await caches.keys()) if (OLD_CACHES.test(name) && name !== CACHE_NAME) await caches.delete(name)
  const cache = await caches.open(CACHE_NAME)
  let done = 0
  const step = (n: number) => {
    done += n
    onProgress(Math.min(1, done / DICTATION_BYTES))
  }
  for (const [name, file] of Object.entries(DICTATION_FILES)) {
    if (await cache.match(keyOf(name))) {
      step(file.size)
      continue
    }
    let res: Response
    try {
      res = await fetcher(`${relay}${DICTATION_PATH}${name}`, { cache: "no-store" })
    } catch {
      throw new DictationProblem("Dictation isn't available: the relay can't be reached.")
    }
    if (!res.ok) throw new DictationProblem(`Dictation isn't available here. ${await said(res)}`)
    const bytes = await readAll(res, step)
    if (bytes.byteLength !== file.size || (await sha256Hex(bytes)) !== file.sha256) throw new DictationProblem("The dictation model didn't match its pinned hash, so it wasn't kept or used.")
    await cache.put(keyOf(name), new Response(bytes))
  }
  onProgress(1)
}
