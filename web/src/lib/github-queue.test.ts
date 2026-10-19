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
