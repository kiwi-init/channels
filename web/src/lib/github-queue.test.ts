import { expect, test } from "bun:test"

import { RelayError } from "@kiwi/core/client/errors.ts"

import { drain } from "./github-queue"

const items = [{ seq: 1 }, { seq: 2 }, { seq: 3 }]

test("a rate-limited, unreachable or failing relay keeps the item to try again; a refusal that won't change moves on", async () => {
  for (const err of [new RelayError(429, "too many messages; wait a minute", "TooMany", 30), new TypeError("Failed to fetch"), new RelayError(503, "relay is restarting")]) {
    const done: number[] = []
    const all = await drain(
      items,
      async (i) => (i.seq === 2 ? Promise.reject(err) : undefined),
      (seq) => void done.push(seq)
    )
    expect({ all, done }).toEqual({ all: false, done: [1] })
  }
  const done: number[] = []
  const all = await drain(
    items,
    async (i) => (i.seq === 2 ? Promise.reject(new RelayError(403, "not on this repo")) : undefined),
    (seq) => void done.push(seq)
  )
  expect({ all, done }).toEqual({ all: true, done: [1, 2, 3] })
})

test("a message's items are marked done only once all of them went out, so a failure on the second keeps the whole message for the next try", async () => {
  const shared = [
    { seq: 1, n: "a" },
    { seq: 4, n: "b" },
    { seq: 4, n: "c" },
    { seq: 5, n: "d" },
  ]
  const posted: string[] = []
  const done: number[] = []
  const all = await drain(
    shared,
    async (i) => {
      if (i.n === "c") throw new RelayError(503, "relay is restarting")
      posted.push(i.n)
    },
    (seq) => void done.push(seq)
  )
  expect({ all, posted, done }).toEqual({ all: false, posted: ["a", "b"], done: [1] })
  const again: number[] = []
  expect(
    await drain(
      shared.slice(1),
      async () => undefined,
      (seq) => void again.push(seq)
    )
  ).toBe(true)
  expect(again).toEqual([4, 5])
})
