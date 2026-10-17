export const MAX_SIDE = 2048
const SCALES = [1, 0.75, 0.5, 0.35, 0.25]
const QUALITIES = [0.9, 0.8, 0.7, 0.55]

export interface Attempt {
  width: number
  height: number
  quality: number
}

export function attempts(width: number, height: number): Attempt[] {
  const fit = Math.min(1, MAX_SIDE / Math.max(width, height))
  return SCALES.flatMap((scale) =>
    QUALITIES.map((quality) => ({
      width: Math.max(1, Math.round(width * fit * scale)),
      height: Math.max(1, Math.round(height * fit * scale)),
      quality,
    }))
  )
}

export function renamed(name: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png")
  const dot = name.lastIndexOf(".")
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`
}

export function needsCompressing(file: { size: number; type: string }, limit: number): boolean {
  return file.size > limit && file.type !== "image/gif"
}

function encode(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

export async function compressImage(file: File, limit: number): Promise<{ name: string; mime: string; data: string } | null> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  try {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    for (const a of attempts(bitmap.width, bitmap.height)) {
      canvas.width = a.width
      canvas.height = a.height
      ctx.clearRect(0, 0, a.width, a.height)
      ctx.drawImage(bitmap, 0, 0, a.width, a.height)
      const blob = await encode(canvas, "image/webp", a.quality)
      if (!blob || blob.type !== "image/webp" || blob.size > limit) continue
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      return { name: renamed(file.name, "image/webp"), mime: "image/webp", data: url.slice(url.indexOf(",") + 1) }
    }
    return null
  } finally {
    bitmap.close()
  }
}
