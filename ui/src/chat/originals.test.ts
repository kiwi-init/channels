import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { base64Of, dropOriginal, holdOriginal, keepOriginal, originalBlob, originalCount, originalData, originalMime } from "~/chat/originals"

const PNG = base64Of(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 250, 251, 252]))
const real = { make: URL.createObjectURL, revoke: URL.revokeObjectURL }
let made = 0
let revoked: string[] = []

beforeEach(() => {
  made = 0
  revoked = []
  URL.createObjectURL = () => `blob:test/${++made}`
  URL.revokeObjectURL = (url: string) => void revoked.push(url)
})
afterEach(() => {
  URL.createObjectURL = real.make
  URL.revokeObjectURL = real.revoke
})

describe("a picture's original is one binary copy behind a short URL (T2472)", () => {
  test("it keeps the exact bytes and the type, and gives them back as base64 on request", async () => {
    const url = keepOriginal("image/png", PNG)
    expect(url).toBe("blob:test/1")
    expect(originalMime(url)).toBe("image/png")
    expect(originalBlob(url)?.size).toBe(15)
    expect(await originalData(url)).toBe(PNG)
    dropOriginal(url)
  })

  test("dropping it revokes the URL and forgets the bytes", async () => {
    const before = originalCount()
    const url = keepOriginal("image/jpeg", PNG)
    dropOriginal(url)
    expect(revoked).toEqual([url])
    expect(originalCount()).toBe(before)
    expect(originalBlob(url)).toBeUndefined()
    await expect(originalData(url)).rejects.toThrow("no longer held")
  })

  test("while the viewer holds it, a drop waits; letting go then revokes it once", () => {
    const url = keepOriginal("image/png", PNG)
    const a = holdOriginal(url)
    const b = holdOriginal(url)
    dropOriginal(url)
    expect(revoked).toEqual([])
    a()
    a()
    expect(revoked).toEqual([])
    b()
    expect(revoked).toEqual([url])
  })

  test("a hold that ends without a drop keeps the picture", () => {
    const url = keepOriginal("image/png", PNG)
    holdOriginal(url)()
    expect(revoked).toEqual([])
    expect(originalBlob(url)).toBeDefined()
    dropOriginal(url)
  })

  test("a data: URL from elsewhere (an unsent image, a doc's file) still reads as before", async () => {
    const url = `data:image/webp;base64,${PNG}`
    expect(originalMime(url)).toBe("image/webp")
    expect(await originalData(url)).toBe(PNG)
    expect(holdOriginal(url)).toBeInstanceOf(Function)
    dropOriginal(url)
    expect(revoked).toEqual([])
  })
})
