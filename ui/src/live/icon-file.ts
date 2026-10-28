import { MAX_ICON_BYTES, type ChannelIcon } from "@kiwi/core/protocol.ts"

const SIDE = 128

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("the image couldn't be encoded"))), type, quality))

const base64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ""
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text)
}

export async function iconFromFile(file: File): Promise<ChannelIcon> {
  if (!file.type.startsWith("image/")) throw new Error("that isn't an image")
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  canvas.width = SIDE
  canvas.height = SIDE
  const g = canvas.getContext("2d")
  if (!g) throw new Error("the image couldn't be drawn")
  const side = Math.min(bitmap.width, bitmap.height)
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE)
  bitmap.close()
  const png = await blobOf(canvas, "image/png")
  if (png.size <= MAX_ICON_BYTES) return { kind: "image", mime: "image/png", data: await base64(png) }
  for (const quality of [0.9, 0.75, 0.6]) {
    const jpeg = await blobOf(canvas, "image/jpeg", quality)
    if (jpeg.size <= MAX_ICON_BYTES) return { kind: "image", mime: "image/jpeg", data: await base64(jpeg) }
  }
  throw new Error("that image is too detailed for an icon")
}
