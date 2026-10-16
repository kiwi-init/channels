import { Inflate, deflateSync } from "fflate"

export async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(deflateSync(bytes))
}

export async function inflateRaw(bytes: Uint8Array<ArrayBuffer>, cap: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const parts: Uint8Array[] = []
  let size = 0
  let over = false
  const stream = new Inflate((chunk) => {
    size += chunk.byteLength
    if (size > cap) over = true
    else parts.push(chunk)
  })
  stream.push(bytes, true)
  if (over) return null
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}
