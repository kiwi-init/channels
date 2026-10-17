import { MAX_IMAGE_BYTES, RASTER_MIMES } from "@mc/protocol.ts"

export const MAX_ATTACHMENTS = 8
export const MAX_SIDE = 2048

const SCALES = [1, 0.75, 0.5, 0.35, 0.25]
const QUALITIES = [0.9, 0.8, 0.7, 0.55]

export interface Picked {
  uri: string
  name: string
  mime: string
  size: number
  width: number
  height: number
}

export interface Attachment {
  id: string
  name: string
  uri: string
  mime: string
  size: number
}

interface Shrunk {
  uri: string
  size: number
}

export interface Platform {
  pick: (limit: number) => Promise<Picked[]>
  shrink: (picked: Picked, width: number, quality: number) => Promise<Shrunk>
  readBase64: (uri: string) => Promise<string>
  newId: () => string
}

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

export function needsCompressing(picked: Pick<Picked, "size" | "mime">, limit = MAX_IMAGE_BYTES): boolean {
  return picked.size > limit && picked.mime !== "image/gif"
}

const kb = (n: number) => Math.round(n / 1024)

export async function prepare(picked: readonly Picked[], held: number, platform: Platform, limit = MAX_IMAGE_BYTES): Promise<{ added: Attachment[]; problems: string[] }> {
  const added: Attachment[] = []
  const problems: string[] = []
  for (const p of picked.slice(0, Math.max(0, MAX_ATTACHMENTS - held))) {
    if (!(RASTER_MIMES as readonly string[]).includes(p.mime)) {
      problems.push(`${p.name} isn’t a PNG, JPEG, GIF, or WebP.`)
      continue
    }
    if (p.size <= limit) {
      added.push({ id: platform.newId(), name: p.name, uri: p.uri, mime: p.mime, size: p.size })
      continue
    }
    if (!needsCompressing(p, limit)) {
      problems.push(`${p.name} is over ${kb(limit)} KB. Attach a smaller image.`)
      continue
    }
    let done: Attachment | null = null
    for (const a of attempts(p.width, p.height)) {
      const out = await platform.shrink(p, a.width, a.quality)
      if (out.size <= limit) {
        done = { id: platform.newId(), name: renamed(p.name, "image/jpeg"), uri: out.uri, mime: "image/jpeg", size: out.size }
        break
      }
    }
    if (done) added.push(done)
    else problems.push(`${p.name} couldn’t be shrunk under ${kb(limit)} KB.`)
  }
  if (picked.length > Math.max(0, MAX_ATTACHMENTS - held) && problems.length === 0) problems.push(`At most ${MAX_ATTACHMENTS} images go in one message.`)
  return { added, problems }
}

export async function inline(attachments: readonly Attachment[], platform: Pick<Platform, "readBase64">): Promise<{ name: string; mime: string; data: string }[]> {
  return Promise.all(attachments.map(async (a) => ({ name: a.name, mime: a.mime, data: await platform.readBase64(a.uri) })))
}
