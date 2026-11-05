import { expect, test } from "bun:test"
import { kept, keptCodes } from "~/live/keep"
import type { Message } from "~/model"

const msg = (seq: number): Message => ({ seq, from: "atlas", at: seq, text: `m${seq}`, where: { kind: "room", room: "general" } })

test("rows are kept for the last two channels shown, and a revisit counts as recent", () => {
  kept("keep-a", [msg(1)])
  kept("keep-b", [msg(1)])
  kept("keep-a", [msg(1), msg(2)])
  kept("keep-c", [msg(1)])
  expect(keptCodes().filter((c) => c.startsWith("keep-"))).toEqual(["keep-a", "keep-c"])
  const again = [msg(1)]
  expect(kept("keep-c", again)[0]).not.toBe(again[0])
})
