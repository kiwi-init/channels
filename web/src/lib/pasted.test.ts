import { describe, expect, test } from "bun:test"

import type { KiwiBridge, PastedImage } from "../../../desktop/src/bridge.ts"
import { emptyPaste, takePasted } from "./pasted"

const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"

function desktop(got: PastedImage | null): { b: KiwiBridge; asked: () => number } {
  let asks = 0
  const b = {
    takePastedImage: async () => {
      asks++
      return got
    },
  } as unknown as KiwiBridge
  return { b, asked: () => asks }
}

const paste = (types: string[] = [], text = "", files = 0) => ({ types, files: { length: files } as FileList, getData: (t: string) => (t === "text/plain" ? text : "") })

describe("an image pasted into the Linux app, whose paste event WebKitGTK leaves empty (T896)", () => {
  test("only a paste with nothing in it at all counts as empty", () => {
    expect(emptyPaste(paste())).toBe(true)
    expect(emptyPaste(paste(["text/plain"], "hi"))).toBe(false)
    expect(emptyPaste(paste(["Files"], "", 1))).toBe(false)
    expect(emptyPaste(paste(["text/html"]))).toBe(false)
  })

  test("an empty paste on the Linux app takes the clipboard's image from main once, as a PNG File", async () => {
    const { b, asked } = desktop({ type: "image/png", data: btoa("\x89PNG") })
    const got = await takePasted(paste(), b, LINUX)
    expect(asked()).toBe(1)
    expect([got?.name, got?.type, got?.size]).toEqual(["pasted.png", "image/png", 4])
    expect([...new Uint8Array(await got!.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  test("text pastes, the Mac app, the browser and a clipboard with no image never ask main or attach anything", async () => {
    const image = desktop({ type: "image/png", data: btoa("x") })
    expect(await takePasted(paste(["text/plain"], "hello"), image.b, LINUX)).toBeNull()
    expect(await takePasted(paste(), image.b, MAC)).toBeNull()
    expect(await takePasted(paste(), null, LINUX)).toBeNull()
    expect(image.asked()).toBe(0)
    const none = desktop(null)
    expect(await takePasted(paste(), none.b, LINUX)).toBeNull()
    expect(none.asked()).toBe(1)
  })
})
