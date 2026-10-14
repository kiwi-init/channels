import { describe, expect, test } from "bun:test"

import { persistQueue } from "./persist-queue"

describe("persistQueue", () => {
  test("the second job waits for the first, even when the first fails", async () => {
    const enqueue = persistQueue()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const a = enqueue(async () => {
      order.push("a-start")
      await gate
      order.push("a-end")
      throw new Error("a failed")
    })
    const b = enqueue(async () => {
      order.push("b")
    })
    await Promise.resolve()
    expect(order).toEqual(["a-start"])
    release()
    await expect(a).rejects.toThrow("a failed")
    await b
    expect(order).toEqual(["a-start", "a-end", "b"])
  })

  test("overlapping jobs still reject on their own failure", async () => {
    const enqueue = persistQueue()
    const a = enqueue(async () => {
      throw new Error("no")
    })
    const b = enqueue(async () => undefined)
    await expect(a).rejects.toThrow("no")
    await expect(b).resolves.toBeUndefined()
  })
})
