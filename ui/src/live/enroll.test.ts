import { afterEach, describe, expect, test } from "bun:test"

import { enrollBegin, enrollCancel, enrollKeep, enrollingNow, type EnrollDone } from "~/live/account"

type Status = { stage: "asking" } | { stage: "check"; person: { name: string; fingerprint: string } }

const check: Status = { stage: "check", person: { name: "Jow", fingerprint: "3f9a 0c41 77e2 b8d5 1a06" } }

function fakeBridge() {
  const asked: ((s: Status) => void)[] = []
  const calls = { status: 0, keep: 0, cancel: 0 }
  const kiwi = {
    getSnapshot: () => ({}),
    enrollBegin: async () => {},
    enrollStatus: () => {
      calls.status++
      return new Promise<Status>((resolve) => asked.push(resolve))
    },
    enrollKeep: async () => {
      calls.keep++
      return { stage: "done", person: { name: "Jow", pk: "pk", xpk: "xpk" }, channels: [] }
    },
    enrollCancel: async () => {
      calls.cancel++
    },
  }
  Object.assign(globalThis, { window: { kiwi } })
  const polled = async (n: number) => {
    while (asked.length < n) await Bun.sleep(50)
  }
  return { asked, calls, polled }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
})

describe("the enrolling screen follows only the ask it started (#1323)", () => {
  test("a poll that answers after Cancel doesn't bring the key check back", async () => {
    const b = fakeBridge()
    const done: EnrollDone[] = []
    await enrollBegin(
      async () => {},
      (d) => void done.push(d)
    )
    await b.polled(1)
    await enrollCancel()
    b.asked[0]!(check)
    await Bun.sleep(10)
    expect(enrollingNow()).toBeNull()
    await enrollKeep()
    expect(b.calls.keep).toBe(0)
    expect(done).toEqual([])
  })

  test("a poll from an earlier ask doesn't show its key on the next ask's screen, and keep joins the next ask", async () => {
    const b = fakeBridge()
    const first: EnrollDone[] = []
    const second: EnrollDone[] = []
    await enrollBegin(
      async () => {},
      (d) => void first.push(d)
    )
    await b.polled(1)
    await enrollCancel()
    await enrollBegin(
      async () => {},
      (d) => void second.push(d)
    )
    b.asked[0]!(check)
    await Bun.sleep(10)
    expect(enrollingNow()).toEqual({ stage: "asking" })

    await b.polled(2)
    b.asked[1]!(check)
    await Bun.sleep(10)
    expect(enrollingNow()).toEqual(check)
    await enrollKeep()
    expect(b.calls.keep).toBe(1)
    expect(first).toEqual([])
    expect(second).toHaveLength(1)
    expect(enrollingNow()).toBeNull()
  })
})
