import { beforeAll, describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, MemberPicture, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { faceDue } from "~/live/face"
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
const face: MemberPicture = { mime: "image/png", data: btoa("a tiny png, for the test") }

beforeAll(async () => {
  for (const [name, kind] of [
    ["jow", "human"],
    ["ana", "human"],
    ["patient-otter", "agent"],
  ] as const) {
    ids[name] = await generateIdentity(name)
    roster.push({ name, pk: ids[name]!.pk, owner: name === "jow", at: roster.length, active: true, kind })
  }
})

describe("a person's published picture is their face in the app (T380)", () => {
  test("it comes through as an image the avatar can draw", async () => {
    const state = fold([await ev("ana", { op: "picture.set", member: "ana", picture: face })], roster)
    const ana = peopleOf(state, roster, new Map(), "jow", new Map()).find((p) => p.name === "ana")
    expect(ana?.picture).toBe(`data:image/png;base64,${face.data}`)
  })

  test("people without one, and agents, keep their initial or harness", () => {
    const people = peopleOf(fold([], roster), roster, new Map(), "jow", new Map())
    expect(people.map((p) => p.picture)).toEqual([undefined, undefined, undefined])
  })
})

describe("your GitHub picture is published again when the GitHub account changes", () => {
  test("a channel open before the sign-in tries once more once GitHub is linked", () => {
    expect(faceDue(undefined, null)).toBe(true)
    expect(faceDue(null, null)).toBe(false)
    expect(faceDue(null, "harry")).toBe(true)
    expect(faceDue("harry", "harry")).toBe(false)
  })

  test("another account, or unlinking, tries again too", () => {
    expect(faceDue("harry", "jow")).toBe(true)
    expect(faceDue("harry", null)).toBe(true)
  })
})
