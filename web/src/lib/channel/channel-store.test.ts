import { afterEach, describe, expect, test } from "bun:test"

import type { Member } from "@kiwi/core/membership.ts"
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import type { ChannelOps, FollowEvent } from "../../../../desktop/src/bridge.ts"
import { ChannelLink } from "../channel-ops"
import { ChannelStore } from "./channel-store"
import type { StoredMember } from "./store"
import { dropWarm } from "./warm"

const CODE = "mc2-store-test"
const ME = "pk-me"
const member: StoredMember = { code: CODE, identity: { name: "me", pk: ME }, access: { roomId: "room-1", ownerPk: "pk-owner" } as StoredMember["access"], at: 0 }
const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true })
const person = (name: string, pk: string): Member => ({ name, pk, xpk: `x${pk}`, owner: false, at: 0, active: true })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(1)
  expect(ok()).toBe(true)
}

function relay(head = 0) {
  let roster: Member[] = [person("atlas", "pk-atlas")]
  const follows: { since: number; on: (e: FollowEvent) => void; stopped: boolean }[] = []
  const lent = { emitted: [] as string[], released: 0 }
  const answers: Record<string, () => unknown> = {
    head: () => head,
    members: () => roster,
    requests: () => [],
    rotateIfDue: () => false,
    snapshot: () => null,
    snapshotIfDue: () => null,
    snapshotAt: () => null,
    title: () => null,
    guard: () => null,
    rooms: () => null,
    reconcilePosting: () => [],
    send: () => head + 1,
  }
  const ops = {
    call: (_code: string, op: string) => Promise.resolve(answers[op]?.() ?? null),
    presence: () => Promise.resolve(),
    openRows: () => Promise.resolve([]),
    keep: () => Promise.resolve(null),
    openKept: () => Promise.resolve(null),
    nudge: () => {},
    follow: (_code: string, since: number, on: (e: FollowEvent) => void) => {
      const f = { since, on, stopped: false }
      follows.push(f)
      return () => {
        f.stopped = true
      }
    },
  } as unknown as ChannelOps
  const link = new ChannelLink(CODE, "room-1", ME, "pk-owner", ops)
  const lend = () => ({ emit: (e: { _tag: string }) => void lent.emitted.push(e._tag), release: () => void lent.released++ })
  const live = () => follows.at(-1)!
  const say = (e: FollowEvent) => live().on(e)
  const setRoster = (next: Member[]) => {
    roster = next
  }
  return { link, lend, follows, lent, live, say, setRoster }
}

const opened = async (r: ReturnType<typeof relay>, human?: null) => {
  const store = new ChannelStore(member, human, { link: r.link, lend: r.lend })
  const close = store.open()
  if (human !== null) await until(() => r.follows.length > 0)
  return { store, close }
}

afterEach(() => dropWarm(CODE))

describe("a channel store", () => {
  test("follows from the relay's head once open, and goes live on the relay's Open", async () => {
    const r = relay(0)
    const { store, close } = await opened(r)
    expect(r.live().since).toBe(0)
    expect(store.handle.value.connection).toBe("connecting")
    expect(store.handle.value.ready).toBe(true)
    r.say({ _tag: "Open" })
    expect(store.handle.value.connection).toBe("live")
    r.say({ _tag: "Down" })
    expect(store.handle.value.connection).toBe("reconnecting")
    close()
  })

  test("messages heard together land in one 30 ms batch, fold into state, and notify once", async () => {
    const r = relay(0)
    const { store, close } = await opened(r)
    let notified = 0
    const stop = store.subscribe(() => notified++)
    for (const seq of [1, 2, 3]) r.say({ _tag: "Message", message: msg(seq), row: null })
    expect(store.handle.value.messages).toHaveLength(0)
    await sleep(40)
    expect(store.handle.value.messages.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(store.handle.value.state.head).toBe(3)
    expect(notified).toBe(1)
    expect(r.lent.emitted).toContain("Head")
    stop()
    close()
  })

  test("a read mark changes the handle but keeps the folded state: nothing refolds", async () => {
    const r = relay(0)
    const { store, close } = await opened(r)
    r.say({ _tag: "Message", message: msg(1), row: null })
    await sleep(40)
    const before = store.handle.value
    r.say({ _tag: "Read", reads: [{ pk: "pk-atlas", seq: 1, at: 1 }], snapshot: false })
    const after = store.handle.value
    expect(after).not.toBe(before)
    expect(after.state).toBe(before.state)
    close()
  })

  test("pkOf keeps its identity through new messages and changes when the roster does", async () => {
    const r = relay(0)
    const { store, close } = await opened(r)
    const pkOf = store.handle.value.pkOf
    expect(pkOf("atlas")).toBe("pk-atlas")
    r.say({ _tag: "Message", message: msg(1), row: null })
    await sleep(40)
    expect(store.handle.value.pkOf).toBe(pkOf)
    r.setRoster([person("atlas", "pk-atlas"), person("nova", "pk-nova")])
    r.say({ _tag: "Roster" })
    await until(() => store.handle.value.roster.length === 2)
    expect(store.handle.value.pkOf).not.toBe(pkOf)
    expect(store.handle.value.pkOf("nova")).toBe("pk-nova")
    close()
  })

  test("closing stops the follow, gives the watch back, and drops a batch still pending", async () => {
    const r = relay(0)
    const { store, close } = await opened(r)
    r.say({ _tag: "Message", message: msg(1), row: null })
    close()
    await sleep(40)
    expect(r.live().stopped).toBe(true)
    expect(r.lent.released).toBe(1)
    expect(store.handle.value.messages).toHaveLength(0)
  })

  test("the next store for the channel paints the warm window at once and follows past it", async () => {
    const r = relay(0)
    const first = await opened(r)
    for (const seq of [1, 2]) r.say({ _tag: "Message", message: msg(seq), row: null })
    await sleep(40)
    first.close()
    const again = relay(2)
    const store = new ChannelStore(member, undefined, { link: again.link, lend: again.lend })
    expect(store.handle.value.ready).toBe(true)
    expect(store.handle.value.messages.map((m) => m.seq)).toEqual([1, 2])
    const close = store.open()
    await until(() => again.follows.length > 0)
    expect(again.live().since).toBe(2)
    close()
  })

  test("with the sign-in known to be gone, it never follows", async () => {
    const r = relay(0)
    const { close } = await opened(r, null)
    await sleep(10)
    expect(r.follows).toHaveLength(0)
    close()
  })
})
