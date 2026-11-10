const blobs = new Map<string, Blob>()
const holds = new Map<string, number>()
const dropped = new Set<string>()

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

export function base64Of(bytes: Uint8Array): string {
  let bin = ""
  for (let at = 0; at < bytes.length; at += 0x8000) bin += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(bin)
}

export function keepOriginal(mime: string, base64: string): string {
  const blob = new Blob([bytesOf(base64)], { type: mime })
  const url = URL.createObjectURL(blob)
  blobs.set(url, blob)
  return url
}

function revoke(url: string): void {
  dropped.delete(url)
  if (!blobs.delete(url)) return
  URL.revokeObjectURL(url)
}

export function dropOriginal(url: string): void {
  if (!blobs.has(url)) return
  if (holds.get(url)) dropped.add(url)
  else revoke(url)
}

export function holdOriginal(url: string): () => void {
  if (!blobs.has(url)) return () => {}
  holds.set(url, (holds.get(url) ?? 0) + 1)
  let held = true
  return () => {
    if (!held) return
    held = false
    const left = (holds.get(url) ?? 1) - 1
    if (left > 0) return void holds.set(url, left)
    holds.delete(url)
    if (dropped.has(url)) revoke(url)
  }
}

export const originalBlob = (url: string): Blob | undefined => blobs.get(url)

export const originalMime = (url: string): string => blobs.get(url)?.type || (/^data:([^;,]+)/.exec(url)?.[1] ?? "image/png")

export async function originalData(url: string): Promise<string> {
  const blob = blobs.get(url)
  if (blob) return base64Of(new Uint8Array(await blob.arrayBuffer()))
  if (url.startsWith("data:")) return url.slice(url.indexOf(",") + 1)
  throw new Error("the image is no longer held")
}

export const originalCount = (): number => blobs.size
