import { describe, expect, test } from "bun:test"
import { PERMISSION_CHOICES } from "@kiwi/core/permission.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import type { Online } from "@/lib/channel/online"
import { asksOf, peopleOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-jow", name: "Jow" } },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", sponsor: { user: "u-maya", name: "Maya" } },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", sponsor: { user: "u-maya", name: "Maya" }, runs: { harness: "claude" } },
  { name: "atlas", pk: "pk-atlas", owner: false, at: 0, active: true, kind: "agent", sponsor: { user: "u-jow", name: "Jow" }, runs: { harness: "claude" } },
]

const idle = (from: string): Online => ({ from, client: "kiwi", at: Date.now(), pk: `pk-${from}`, activity: { state: "idle" }, wakes: false })

describe("who's here (T650)", () => {
  const people = peopleOf(
    fold([], roster, 0),
    roster,
    new Map([
      ["win", idle("win")],
      ["maya", idle("maya")],
    ]),
    "jow",
    new Map([["atlas", false]])
  )
  const of = (name: string) => people.find((p) => p.name === name)

  test("an idle agent is online, not away; an idle person is away", () => {
    expect(of("win")?.presence).toBe("online")
    expect(of("maya")?.presence).toBe("away")
  })

  test("Wake is offered only for agents that run on this computer, and says what it's set to", () => {
    expect(of("atlas")?.wakes).toBe(false)
    expect(of("win")?.wakes).toBeUndefined()
  })
})

describe("a permission card offers only what the answer can do (T650)", () => {
  const ask = {
    v: 1,
    sigOk: true,
    id: "p",
    seq: 5,
    from: "win",
    pk: "pk-win",
    kind: "blocking",
    body: "Allow?",
    ts: 1,
    to: ["maya"],
    esc: true,
    choices: [...PERMISSION_CHOICES],
    permission: { tool: "Bash", command: "git push", cwd: "/work", nonce: "n".repeat(32), expiresAt: 9_000_000_000_000, canAllow: true },
  } as Wire
  const card = (me: string, owner: boolean) => asksOf(fold([ask], roster, 0), [ask], me, owner, [], roster, new Map()).asks[0]

  test("the agent's own person may allow and deny", () => {
    expect(card("maya", false)).toMatchObject({ kind: "permission", canAllow: true, canDeny: true, expiresAt: 9_000_000_000_000 })
  })

  test("the owner may deny, and reads who can allow it", () => {
    const c = card("jow", true)
    expect(c).toMatchObject({ kind: "permission", canAllow: false, canDeny: true, allower: "maya" })
  })
})
