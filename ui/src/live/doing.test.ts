import { beforeAll, describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import type { Online } from "@/lib/channel/online"
import { liveOf, restOf, workingIn } from "~/doing"
import { peopleOf } from "~/live/map"

const ids: Record<string, Identity> = {}
const roster: Roster = []
let seq = 0
async function ev(from: string, e: Event): Promise<Message> {
  seq++
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq }
  const p = await sign(ids[from]!, base)
  return { ...p, seq, rts: seq, sigOk: await verify(p) }
}
const here = (from: string, o: Partial<Online>): [string, Online] => [from, { from, client: "tail", at: Date.now(), pk: ids[from]!.pk, wakes: false, ...o }]

beforeAll(async () => {
  for (const [name, kind] of [
    ["jow", "human"],
    ["busy-otter", "agent"],
    ["calm-heron", "agent"],
  ] as const) {
    ids[name] = await generateIdentity(name)
    roster.push({ name, pk: ids[name]!.pk, owner: name === "jow", at: roster.length, active: true, kind })
  }
})

describe("the feed shows what agents are doing (T603)", () => {
  test("live activity, how it's reached, its tasks and its card come through", async () => {
    const card = await ev("busy-otter", { op: "card", os: "macos", arch: "arm64", cpu: "8 cores", memory: "16 GB", repo: "kiwi-init/landing", branch: "T1", tools: ["git", "bun"] })
    const ship = await ev("jow", { op: "task.add", title: "Ship it", owner: "busy-otter" })
    const claim = await ev("busy-otter", { op: "task.claim", task: ship.seq })
    const then = await ev("jow", { op: "task.add", title: "Then this", owner: "busy-otter" })
    const state = fold([card, ship, claim, then], roster)
    const online = new Map([
      here("busy-otter", { activity: { state: "working", tool: "mcp__kiwi__send", since: 5, context: { used: 300_000, window: 1_000_000 } }, reach: "listening" }),
      here("calm-heron", { wakes: true, client: "daemon" }),
    ])
    const people = peopleOf(state, roster, online, "jow", new Map())
    const otter = people.find((p) => p.name === "busy-otter")!
    const heron = people.find((p) => p.name === "calm-heron")!
    expect(otter.activity).toEqual({ state: "working", tool: "mcp__kiwi__send", since: 5, context: { used: 300_000, window: 1_000_000 } })
    expect(otter.reach).toBe("listening")
    expect(otter.load).toEqual({ level: "busy", doing: [ship.seq], queued: [then.seq], waiting: [] })
    expect(otter.specs).toBe("macOS arm64 · 8 cores · 16 GB")
    expect([otter.repo, otter.branch, otter.outside, otter.tools]).toEqual(["kiwi-init/landing", "T1", false, ["git", "bun"]])
    expect(liveOf(otter)).toEqual({ text: "running send", busy: true, since: 5 })
    expect(heron.reach).toBe("wakes")
    expect(liveOf(heron)).toBeNull()
    expect(restOf(heron)).toBe("wakes on new messages")
    expect(people.find((p) => p.name === "jow")?.load).toBeUndefined()
  })

  test("the feed line names working agents where they work", async () => {
    const ship = await ev("jow", { op: "task.add", title: "Ship it", owner: "busy-otter" })
    const state = fold([ship, await ev("busy-otter", { op: "task.claim", task: ship.seq })], roster)
    const online = new Map([here("busy-otter", { activity: { state: "waiting" } }), here("calm-heron", { activity: { state: "idle" } })])
    const people = peopleOf(state, roster, online, "jow", new Map())
    const names = (w: Parameters<typeof workingIn>[1]) => workingIn(people, w).map((p) => p.name)
    expect(names({ kind: "room", room: "general" })).toEqual(["busy-otter"])
    expect(names({ kind: "task", task: ship.seq })).toEqual(["busy-otter"])
    expect(names({ kind: "task", task: ship.seq + 1 })).toEqual([])
    expect(names({ kind: "dm", with: "calm-heron" })).toEqual([])
    expect(liveOf(people.find((p) => p.name === "busy-otter")!)?.text).toBe("waiting for a person")
  })
})
