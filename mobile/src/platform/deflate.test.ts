import { deflateRawSync, inflateRawSync } from "node:zlib"

import { deflateRaw, inflateRaw } from "./deflate"

const text = new TextEncoder().encode("kiwi channel ".repeat(500))

describe("deflate for Hermes", () => {
  it("writes what the web's DecompressionStream reads", async () => {
    const packed = await deflateRaw(text)
    expect(packed.byteLength).toBeLessThan(text.byteLength)
    expect(new Uint8Array(inflateRawSync(packed))).toEqual(text)
  })

  it("reads what the web's CompressionStream writes", async () => {
    const packed = new Uint8Array(deflateRawSync(text))
    expect(await inflateRaw(packed, text.byteLength)).toEqual(text)
  })

  it("gives up above the cap", async () => {
    const packed = new Uint8Array(deflateRawSync(text))
    expect(await inflateRaw(packed, text.byteLength - 1)).toBeNull()
  })

  it("throws on bytes that are not deflate", async () => {
    await expect(inflateRaw(new Uint8Array([255, 255, 255, 255]), 1024)).rejects.toThrow()
  })
})
