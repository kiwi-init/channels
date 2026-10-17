import { MAX_IMAGE_BYTES } from "@mc/protocol.ts"

import { MAX_ATTACHMENTS, MAX_SIDE, attempts, inline, needsCompressing, prepare, renamed, type Picked, type Platform } from "./attachments"

function platform(sizeOf: (width: number, height: number, quality: number) => number = (w, h, q) => Math.round(w * h * q * 0.35)): Platform & { shrunk: number[][] } {
  const shrunk: number[][] = []
  let n = 0
  return {
    shrunk,
    pick: async () => [],
    shrink: async (picked, width, quality) => {
      const height = Math.round((picked.height * width) / picked.width)
      shrunk.push([width, quality])
      return { uri: `file:///small-${width}-${quality}.jpg`, size: sizeOf(width, height, quality) }
    },
    readBase64: async (uri) => `base64:${uri}`,
    newId: () => `id-${++n}`,
  }
}

const photo = (over: Partial<Picked> = {}): Picked => ({ uri: "file:///big.png", name: "big.png", mime: "image/png", size: 2 * 1024 * 1024, width: 4032, height: 3024, ...over })

describe("prepare", () => {
  it("brings a 2 MB image under 256 KB, as a JPEG, trying the biggest first", async () => {
    const p = platform()
    const { added, problems } = await prepare([photo()], 0, p)
    expect(problems).toEqual([])
    expect(added).toHaveLength(1)
    expect(added[0]?.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
    expect(added[0]).toMatchObject({ name: "big.jpg", mime: "image/jpeg" })
    expect(p.shrunk[0]).toEqual([MAX_SIDE, 0.9])
    expect(p.shrunk.length).toBeGreaterThan(1)
  })

  it("leaves an image that already fits as it is, and never shrinks it", async () => {
    const p = platform()
    const small = photo({ size: 100 * 1024, name: "small.webp", mime: "image/webp" })
    const { added } = await prepare([small], 0, p)
    expect(added).toEqual([{ id: "id-1", name: "small.webp", uri: small.uri, mime: "image/webp", size: small.size }])
    expect(p.shrunk).toEqual([])
  })

  it("refuses a GIF over the limit, since a shrink would flatten it", async () => {
    const p = platform()
    const { added, problems } = await prepare([photo({ name: "loop.gif", mime: "image/gif" })], 0, p)
    expect(added).toEqual([])
    expect(problems).toEqual(["loop.gif is over 256 KB. Attach a smaller image."])
    expect(p.shrunk).toEqual([])
  })

  it("refuses what is not a PNG, JPEG, GIF or WebP", async () => {
    const { added, problems } = await prepare([photo({ name: "clip.mp4", mime: "video/mp4", size: 1000 })], 0, platform())
    expect(added).toEqual([])
    expect(problems).toEqual(["clip.mp4 isn’t a PNG, JPEG, GIF, or WebP."])
  })

  it("says so when an image cannot be shrunk far enough", async () => {
    const { added, problems } = await prepare(
      [photo()],
      0,
      platform(() => 10 * 1024 * 1024)
    )
    expect(added).toEqual([])
    expect(problems).toEqual(["big.png couldn’t be shrunk under 256 KB."])
  })

  it("stops at eight, counting what is already held", async () => {
    const six = Array.from({ length: 5 }, (_, i) => photo({ uri: `file:///${i}.png`, name: `${i}.png`, size: 1000 }))
    const { added, problems } = await prepare(six, 5, platform())
    expect(added).toHaveLength(MAX_ATTACHMENTS - 5)
    expect(problems).toEqual([`At most ${MAX_ATTACHMENTS} images go in one message.`])
    expect((await prepare(six, MAX_ATTACHMENTS, platform())).added).toEqual([])
  })
})

describe("helpers", () => {
  it("shrink a long side to the cap and never upscale, from the biggest attempt down", () => {
    expect(attempts(4096, 2048)[0]).toEqual({ width: MAX_SIDE, height: MAX_SIDE / 2, quality: 0.9 })
    expect(attempts(800, 600)[0]).toEqual({ width: 800, height: 600, quality: 0.9 })
    expect(attempts(3000, 10)).toHaveLength(20)
    const widths = attempts(3000, 10).map((a) => a.width)
    expect(widths).toEqual([...widths].sort((x, y) => y - x))
    expect(attempts(3000, 10).every((a) => a.width >= 1 && a.height >= 1)).toBe(true)
  })

  it("only compress a still image over the limit", () => {
    expect(needsCompressing({ size: 300_000, mime: "image/png" })).toBe(true)
    expect(needsCompressing({ size: 100_000, mime: "image/png" })).toBe(false)
    expect(needsCompressing({ size: 300_000, mime: "image/gif" })).toBe(false)
  })

  it("rename a file for its new type", () => {
    expect(renamed("shot.png", "image/jpeg")).toBe("shot.jpg")
    expect(renamed("noext", "image/webp")).toBe("noext.webp")
  })

  it("read each attachment's bytes as base64 for sending", async () => {
    const out = await inline([{ id: "a", name: "a.jpg", uri: "file:///a.jpg", mime: "image/jpeg", size: 10 }], platform())
    expect(out).toEqual([{ name: "a.jpg", mime: "image/jpeg", data: "base64:file:///a.jpg" }])
  })
})
