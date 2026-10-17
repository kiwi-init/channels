import { describe, expect, test } from "bun:test"
import { SNAPSHOT_EVERY } from "@kiwi/core/protocol.ts"
import { nextSnapshotTry } from "./snapshot-plan"

describe("when the owner's app next tries a snapshot", () => {
  test("500 messages after the relay's snapshot, wherever that is", () => {
    expect(nextSnapshotTry(1000, 600)).toBe(600 + SNAPSHOT_EVERY)
    expect(nextSnapshotTry(1000, 1000)).toBe(1000 + SNAPSHOT_EVERY)
  })

  test("500 messages from now when the relay's snapshot stayed old", () => {
    expect(nextSnapshotTry(1000, 0)).toBe(1000 + SNAPSHOT_EVERY)
    expect(nextSnapshotTry(1000, 500)).toBe(1000 + SNAPSHOT_EVERY)
  })
})
