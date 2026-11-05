import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { moving } from "~/chat/thumb-shrink"
import { DOC_BOX, FEED_BOX, keyOf, scaleFor, Thumbs, thumbSize, type Shot } from "~/chat/thumbs"

const styles = join(import.meta.dir, "../styles")

const boxIn = async (file: string, rule: string): Promise<number> => {
  const css = await Bun.file(join(styles, file)).text()
  const body = new RegExp(`(?:^|\\n)${rule.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] ?? ""
  return Number(/max-width: min\((\d+)px, 100%\)/.exec(body)?.[1])
}

const chunk = (tag: string, size = 0): number[] => [0, 0, 0, size, ...[...tag].map((c) => c.charCodeAt(0)), ...Array<number>(size + 4).fill(0)]
const pngOf = (...tags: string[]): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", 13), ...tags.flatMap((t) => chunk(t, 8))])
const webpOf = (fourcc: string, flags: number): Uint8Array =>
  new Uint8Array(
    [..."RIFF"]
      .map((c) => c.charCodeAt(0))
      .concat(
        [0, 0, 0, 0],
        [..."WEBP"].map((c) => c.charCodeAt(0)),
        [...fourcc].map((c) => c.charCodeAt(0)),
        [10, 0, 0, 0, flags, 0, 0, 0]
      )
  )

const pending = (): { wait: Promise<Shot>; done: (shot: Shot) => void } => {
  let done: (shot: Shot) => void = () => {}
  const wait = new Promise<Shot>((ok) => {
    done = ok
  })
  return { wait, done }
}

const shot = (thumb: string | null): Shot => ({ width: 3232, height: 2148, thumb })

function store(spare: number): { thumbs: Thumbs; made: string[] } {
  const made: string[] = []
  const thumbs = new Thumbs((url) => {
    made.push(url)
    return Promise.resolve(shot(`small:${url}`))
  }, spare)
  return { thumbs, made }
}

describe("chat images show from a copy sized to their box", () => {
  test("the boxes match the CSS that lays the images out", async () => {
    expect(await boxIn("chat.css", ".msg-image")).toBe(FEED_BOX)
    expect(await boxIn("thread-doc.css", ".doc-image")).toBe(DOC_BOX)
  })

  test("a Retina screenshot in the feed becomes a copy two device pixels per CSS pixel wide", () => {
    expect(thumbSize(3232, 2148, FEED_BOX, 2)).toEqual({ width: 720, height: 479 })
    expect(thumbSize(3232, 2148, DOC_BOX, 2)).toEqual({ width: 960, height: 638 })
    expect(thumbSize(3232, 2148, FEED_BOX, 3)).toEqual({ width: 1080, height: 718 })
    expect(thumbSize(400, 9000, FEED_BOX, 2)).toBeNull()
  })

  test("an image no wider than the copy would be shows as it is", () => {
    expect(thumbSize(720, 480, FEED_BOX, 2)).toBeNull()
    expect(thumbSize(721, 480, FEED_BOX, 2)).toEqual({ width: 720, height: 479 })
    expect(thumbSize(5000, 1, FEED_BOX, 2)).toEqual({ width: 720, height: 1 })
  })

  test("the copy is at least twice the box, so it stays sharp when a window moves to a Retina screen", () => {
    expect([1, 1.25, 1.5, 2, 2.5, 3].map(scaleFor)).toEqual([2, 2, 2, 2, 3, 3])
    expect(new Set([keyOf("a", FEED_BOX, 2), keyOf("a", DOC_BOX, 2), keyOf("a", FEED_BOX, 3), keyOf("b", FEED_BOX, 2)]).size).toBe(4)
  })

  test("moving images (GIF, APNG, animated WebP) never get a still copy", () => {
    expect(moving(new Uint8Array([0x47, 0x49, 0x46]), "image/gif")).toBe(true)
    expect(moving(pngOf("acTL", "IDAT"), "image/png")).toBe(true)
    expect(moving(pngOf("IDAT", "acTL"), "image/png")).toBe(false)
    expect(moving(pngOf("pHYs", "IDAT"), "image/png")).toBe(false)
    expect(moving(webpOf("VP8X", 0x02), "image/webp")).toBe(true)
    expect(moving(webpOf("VP8X", 0x10), "image/webp")).toBe(false)
    expect(moving(webpOf("VP8 ", 0x02), "image/webp")).toBe(false)
    expect(moving(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(false)
  })
})

describe("the copies are kept while shown and a few after", () => {
  test("one image is made once, however many places ask for it", async () => {
    const { thumbs, made } = store(4)
    await Promise.all([thumbs.warm("a", "data:a", FEED_BOX, 2), thumbs.take("a", "data:a", FEED_BOX, 2), thumbs.take("a", "data:a", FEED_BOX, 2)])
    expect(made).toEqual(["data:a"])
    expect(thumbs.peek("a")?.thumb).toBe("small:data:a")
  })

  test("a copy on screen is never dropped; past the spare count the oldest one off screen is", async () => {
    const { thumbs } = store(2)
    await thumbs.take("shown", "data:shown", FEED_BOX, 2)
    for (const k of ["a", "b", "c"]) await thumbs.warm(k, `data:${k}`, FEED_BOX, 2)
    expect(["shown", "a", "b", "c"].map((k) => thumbs.peek(k)?.thumb ?? null)).toEqual(["small:data:shown", null, "small:data:b", "small:data:c"])
    thumbs.free("shown")
    expect(["shown", "a", "b", "c"].map((k) => thumbs.peek(k)?.thumb ?? null)).toEqual(["small:data:shown", null, null, "small:data:c"])
  })

  test("scrolling back to a copy kept off screen shows it at once, without making it again", async () => {
    const { thumbs, made } = store(2)
    await thumbs.take("a", "data:a", FEED_BOX, 2)
    thumbs.free("a")
    expect(thumbs.peek("a")?.thumb).toBe("small:data:a")
    await thumbs.take("a", "data:a", FEED_BOX, 2)
    expect(made).toEqual(["data:a"])
  })

  test("a copy dropped while it was being made isn't kept when it arrives", async () => {
    const slow = pending()
    const thumbs = new Thumbs((url) => (url === "data:slow" ? slow.wait : Promise.resolve(shot(`small:${url}`))), 1)
    const late = thumbs.warm("slow", "data:slow", FEED_BOX, 2)
    await thumbs.warm("b", "data:b", FEED_BOX, 2)
    slow.done(shot("small:slow"))
    expect((await late).width).toBe(3232)
    expect(thumbs.peek("slow")).toBeNull()
    expect(thumbs.peek("b")?.thumb).toBe("small:data:b")
  })

  test("an image that fails is forgotten, so a retry makes it again", async () => {
    let tries = 0
    const thumbs = new Thumbs(() => (++tries === 1 ? Promise.reject(new Error("bad bytes")) : Promise.resolve(shot("small:ok"))), 4)
    await expect(thumbs.take("a", "data:a", FEED_BOX, 2)).rejects.toThrow("bad bytes")
    thumbs.free("a")
    expect((await thumbs.take("a", "data:a", FEED_BOX, 2)).thumb).toBe("small:ok")
    expect(tries).toBe(2)
  })
})
