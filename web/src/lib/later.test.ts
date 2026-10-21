import { describe, expect, test } from "bun:test"

import { later, onLoadFailed } from "./later"

describe("a lazy view that fails to load", () => {
  test("tells whoever listens, so the app can say to reload, and loads again on the next try", async () => {
    let tries = 0
    let heard = 0
    const stop = onLoadFailed(() => heard++)
    const View = () => null
    const part = later(() => (++tries === 1 ? Promise.reject(new TypeError("Failed to fetch dynamically imported module")) : Promise.resolve(View)))
    part.load()
    await Bun.sleep(0)
    expect(heard).toBe(1)
    part.load()
    await Bun.sleep(0)
    part.load()
    await Bun.sleep(0)
    expect(tries).toBe(2)
    expect(heard).toBe(1)
    stop()
  })
})
