import { describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts"
import { peopleOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", addsAgents: true, answersDecisions: true },
  { name: "lin", pk: "pk-lin", owner: false, at: 0, active: true, kind: "human" },
  { name: "patient-otter", pk: "pk-otter", owner: false, at: 0, active: true, kind: "agent", addsAgents: true },
]
const people = peopleOf(fold([], roster, 0), roster, new Map(), "jow", new Map())
const by = (name: string) => people.find((p) => p.name === name)

describe("a person's powers show on their profile (T380)", () => {
  test("powers the owner granted are read from the roster", () => {
    expect(by("maya")).toMatchObject({ addsAgents: true, answersDecisions: true })
  })

  test("people without them, and agents, carry none", () => {
    expect(by("lin")?.addsAgents).toBeUndefined()
    expect(by("lin")?.answersDecisions).toBeUndefined()
    expect(by("patient-otter")?.addsAgents).toBeUndefined()
  })
})

describe("a power given after someone joined shows, whatever the roster record says (T1656)", () => {
  const signedEvent = async (who: Identity, name: string, seq: number, ev: Event): Promise<Message> => {
    const p = await sign(who, { v: 1 as const, id: crypto.randomUUID(), ts: seq * 1000, from: name, kind: "event" as const, body: "", ev })
    return { ...p, seq, rts: seq * 1000, sigOk: await verify(p) } as Message
  }

  test("a grant from before the channel's snapshot still counts, in a channel that already existed", async () => {
    const owner = await generateIdentity("jow")
    const maya = await generateIdentity("maya")
    const list: Roster = [
      { name: "jow", pk: owner.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "maya", pk: maya.pk, owner: false, at: 0, active: true, kind: "human" },
    ]
    const give = await signedEvent(owner, "jow", 1, { op: "power.set", member: "maya", pk: maya.pk, power: "managesAgents", on: true, was: false } as Event)
    let base: FoldBase | undefined
    fold([give], list, 2000, undefined, undefined, undefined, (b) => void (base = b))
    expect(base).toBeDefined()
    const later = fold([], list, 3000, undefined, undefined, base)
    expect(later.members.get("maya")?.managesAgents).toBe(true)
    expect(peopleOf(later, list, new Map(), "maya", new Map()).find((p) => p.name === "maya")?.managesAgents).toBe(true)
  })

  test("the owner's later grant counts, and so does taking it back", async () => {
    const owner = await generateIdentity("jow")
    const maya = await generateIdentity("maya")
    const list: Roster = [
      { name: "jow", pk: owner.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "maya", pk: maya.pk, owner: false, at: 0, active: true, kind: "human" },
    ]
    const give = await signedEvent(owner, "jow", 1, { op: "power.set", member: "maya", pk: maya.pk, power: "managesAgents", on: true, was: false } as Event)
    const given = fold([give], list, 2000)
    expect(given.members.get("maya")?.managesAgents).toBe(true)
    expect(peopleOf(given, list, new Map(), "maya", new Map()).find((p) => p.name === "maya")?.managesAgents).toBe(true)
    const take = await signedEvent(owner, "jow", 2, { op: "power.set", member: "maya", pk: maya.pk, power: "managesAgents", on: false, was: true } as Event)
    const taken = fold([give, take], [{ ...list[0]! }, { ...list[1]!, managesAgents: true }], 3000)
    expect(peopleOf(taken, list, new Map(), "maya", new Map()).find((p) => p.name === "maya")?.managesAgents).toBeUndefined()
  })
})

describe("an agent shows as yours on every seat of the person it works for (T1673)", () => {
  const list: Roster = [
    { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
    { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", sponsor: { user: "person-maya", name: "Maya", handle: "maya" } },
    { name: "maya-2", pk: "pk-maya-2", owner: false, at: 0, active: true, kind: "human", sponsor: { user: "person-maya", name: "Maya", handle: "maya" } },
    {
      name: "tia",
      pk: "pk-tia",
      owner: false,
      at: 0,
      active: true,
      kind: "human",
      sponsor: { user: "person-tia", name: "Tia", handle: "tia" },
      addsAgents: true,
      answersDecisions: true,
      managesAgents: true,
    },
    { name: "mo", pk: "pk-mo", owner: false, at: 0, active: true, kind: "agent", sponsor: { user: "person-maya", name: "Maya", handle: "maya" } },
  ]
  const state = fold([], list, 0)
  const mo = (me: string) => peopleOf(state, list, new Map(), me, new Map()).find((p) => p.name === "mo")

  test("from either of maya's seats, and never for someone else, fully trusted or not", () => {
    expect(mo("maya")?.yours).toBe(true)
    expect(mo("maya-2")?.yours).toBe(true)
    expect(mo("tia")?.yours).toBeUndefined()
    expect(mo("jow")?.yours).toBeUndefined()
  })
})
