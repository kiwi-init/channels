import { describe, expect, test } from "bun:test"

import { sendsInTurn, withSentQuotes } from "./send-order"

const later = <T>(ms: number, value: T, fail = false): Promise<T> => new Promise((ok, no) => setTimeout(() => (fail ? no(new Error("relay said no")) : ok(value)), ms))

describe("messages go out in the order they were typed", () => {
  test("a quick second send waits for a slow first one", async () => {
    const inTurn = sendsInTurn()
    const order: string[] = []
    await Promise.all([inTurn(() => later(30, "first").then((v) => void order.push(v))), inTurn(() => later(1, "second").then((v) => void order.push(v)))])
    expect(order).toEqual(["first", "second"])
  })

  test("one that fails doesn't hold back the next", async () => {
    const inTurn = sendsInTurn()
    const first = inTurn(() => later(5, 0, true))
    const second = inTurn(() => later(1, 2))
    await expect(first).rejects.toThrow("relay said no")
    expect(await second).toBe(2)
  })
})

describe("a reply to a message still sending", () => {
  test("quotes it by the seq the relay gave it", async () => {
    const sent = new Map([[7, later(5, 412)]])
    expect(await withSentQuotes({ kind: "msg", re: [-7, 300] }, (key) => sent.get(key))).toEqual({ kind: "msg", re: [412, 300] })
  })

  test("goes out without the quote when that message failed, never with a negative seq", async () => {
    const sent = new Map([[7, later(5, 0, true)]])
    expect(await withSentQuotes({ kind: "msg", re: [-7] }, (key) => sent.get(key))).toEqual({ kind: "msg", re: undefined })
    expect(await withSentQuotes({ kind: "msg", re: [-9] }, () => undefined)).toEqual({ kind: "msg", re: undefined })
  })

  test("a reply to a sent message is left as it is", async () => {
    const o = { kind: "msg" as const, re: [300] }
    expect(await withSentQuotes(o, () => undefined)).toBe(o)
  })
})
