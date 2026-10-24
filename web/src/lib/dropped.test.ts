import { describe, expect, test } from "bun:test"

import type { DroppedFile, KiwiBridge } from "../../../desktop/src/bridge.ts"
import { asFiles, fileDrag, takeDropped } from "./dropped"

const LINUX = "Linux x86_64 Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
const MAC = "MacIntel Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"

function desktop(got: DroppedFile[]): { b: KiwiBridge; asked: () => number } {
  let asks = 0
  const b = {
    takeDroppedFiles: async () => {
      asks++
      return got
    },
  } as unknown as KiwiBridge
  return { b, asked: () => asks }
}

const drag = (types: string[]) => ({ types })

describe("files dropped on the Linux app, which WebKitGTK hands the page as file:// URLs", () => {
  test("a file drag is one with Files anywhere, and on the Linux app also a URL list", () => {
    const { b } = desktop([])
    expect(fileDrag(drag(["Files"]), null, MAC)).toBe(true)
    expect(fileDrag(drag(["text/uri-list", "text/html"]), b, LINUX)).toBe(true)
    expect(fileDrag(drag(["text/uri-list"]), b, MAC)).toBe(false)
    expect(fileDrag(drag(["text/uri-list"]), null, LINUX)).toBe(false)
    expect(fileDrag(drag(["text/plain"]), b, LINUX)).toBe(false)
  })

  test("a drop of local files takes them from the app once, as Files; what it refused comes back to say", async () => {
    const { b, asked } = desktop([
      { name: "shot.png", type: "image/png", data: btoa("\x89PNG") },
      { name: "notes.txt", refused: "notes.txt isn’t a PNG, JPEG, GIF, or WebP." },
    ])
    const got = await takeDropped(drag(["text/uri-list", "text/html"]), b, LINUX)
    expect(asked()).toBe(1)
    expect(got.files.map((f) => [f.name, f.type, f.size])).toEqual([["shot.png", "image/png", 4]])
    expect([...new Uint8Array(await got.files[0]!.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(got.refused).toEqual(["notes.txt isn’t a PNG, JPEG, GIF, or WebP."])
  })

  test("a drop outside the Linux app, or one with no URL list, asks the app for nothing", async () => {
    const { b, asked } = desktop([{ name: "x.png", type: "image/png", data: "" }])
    expect(await takeDropped(drag(["text/uri-list"]), b, MAC)).toEqual({ files: [], refused: [] })
    expect(await takeDropped(drag(["text/uri-list"]), null, LINUX)).toEqual({ files: [], refused: [] })
    expect(await takeDropped(drag(["text/plain"]), b, LINUX)).toEqual({ files: [], refused: [] })
    expect(asked()).toBe(0)
  })

  test("a dropped web link asks the app, which has no dropped files to give", async () => {
    const { b, asked } = desktop([])
    expect(await takeDropped(drag(["text/uri-list"]), b, LINUX)).toEqual({ files: [], refused: [] })
    expect(asked()).toBe(1)
  })

  test("asFiles keeps the order and skips nothing it was given", () => {
    const { files, refused } = asFiles([
      { name: "a.png", type: "image/png", data: btoa("a") },
      { name: "b.gif", refused: "too big" },
      { name: "c.webp", type: "image/webp", data: btoa("cc") },
    ])
    expect(files.map((f) => f.name)).toEqual(["a.png", "c.webp"])
    expect(refused).toEqual(["too big"])
  })
})
