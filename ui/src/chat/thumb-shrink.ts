const tagAt = (bytes: Uint8Array, at: number, tag: string): boolean => [...tag].every((c, i) => bytes[at + i] === c.charCodeAt(0))

export function moving(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/gif") return true
  if (mime === "image/webp") return tagAt(bytes, 12, "VP8X") && ((bytes[20] ?? 0) & 0x02) !== 0
  if (mime !== "image/png") return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let at = 8; at + 8 <= bytes.length; at += view.getUint32(at) + 12) {
    if (tagAt(bytes, at + 4, "acTL")) return true
    if (tagAt(bytes, at + 4, "IDAT")) return false
  }
  return false
}

async function png(bitmap: ImageBitmap): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const g = canvas.getContext("2d")
    if (!g) throw new Error("no 2d canvas")
    g.drawImage(bitmap, 0, 0)
    return canvas.convertToBlob({ type: "image/png" })
  }
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const g = canvas.getContext("2d")
  if (!g) throw new Error("no 2d canvas")
  g.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error("the canvas gave no png")
  return blob
}

async function dataUrlOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ""
  for (let at = 0; at < bytes.length; at += 0x8000) bin += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return `data:${blob.type};base64,${btoa(bin)}`
}

export async function shrink(url: string, width: number, height: number): Promise<string | null> {
  const mime = url.slice(url.indexOf(":") + 1, url.indexOf(";"))
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0))
  if (moving(bytes, mime)) return null
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { resizeWidth: width, resizeQuality: "high" })
  try {
    if (bitmap.width !== width || Math.abs(bitmap.height - height) > 1) return null
    return await dataUrlOf(await png(bitmap))
  } finally {
    bitmap.close()
  }
}

export interface ShrinkAsk {
  id: number
  url: string
  width: number
  height: number
}

export type ShrinkReply = { id: number; thumb: string | null } | { id: number; failed: string }
