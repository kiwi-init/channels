import { describe, expect, test } from "bun:test"
import { PERMISSION_CHOICES } from "@kiwi/core/permission.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import type { Online } from "@kiwi/channel/online.ts"
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

describe("Needs you shows what an ask is about (T653)", () => {
  const base = { v: 1, sigOk: true, pk: "pk-win", from: "win", kind: "blocking", ts: 1, esc: true } as const
  const edit = {
    ...base,
    id: "e",
    seq: 7,
    body: "Allow?",
    to: ["maya"],
    choices: [...PERMISSION_CHOICES],
    permission: {
      tool: "Edit",
      paths: ["src/a.ts"],
      replaced: "old​",
      content: "new",
      cwd: "/work",
      sandbox: "off",
      background: true,
      nonce: "n".repeat(32),
      expiresAt: 9_000_000_000_000,
      canAllow: true,
    },
  } as Wire
  const asksFor = (m: Wire, me = "maya") => asksOf(fold([m], roster, 0), [m], me, false, [], roster, new Map()).asks[0]

  test("a permission says what it wants, where, the diff and its warnings", () => {
    expect(asksFor(edit)).toMatchObject({
      kind: "permission",
      title: "wants to edit a file",
      code: "src/a.ts",
      cwd: "/work",
      replaced: "old\\u{200b}",
      content: "new",
      notes: ["It asks to run outside the sandbox: allow that in the terminal.", "It runs in the background."],
    })
  })

  test("a decision wears its kind, an irreversible one apart, and a plain question says who it's for", () => {
    const ask = (over: Partial<Wire>) => ({ ...base, id: "q", seq: 9, body: "Go?", choices: ["A: yes", "B: no"], holds: [], ...over }) as Wire
    expect(asksFor(ask({ to: ["maya"], decision: "irreversible" }))).toMatchObject({ label: "Irreversible step for you", irreversible: true })
    expect(asksFor(ask({ to: ["maya"], decision: "taste" }))).toMatchObject({ label: "Taste call for you" })
    expect(asksFor(ask({ to: ["maya"] }))).toMatchObject({ label: "Decision for you" })
    const decider = roster.map((r) => (r.name === "maya" ? { ...r, answersDecisions: true } : r))
    const put = ask({ to: ["jow"], decision: "taste" })
    expect(asksOf(fold([put], decider, 0), [put], "maya", false, [], decider, new Map()).asks[0]).toMatchObject({ label: "Taste call", askedOf: ["jow"] })
    expect(asksFor(ask({ to: ["maya"], decision: "taste" }))).not.toHaveProperty("askedOf")
    const everyone = asksFor(ask({ esc: undefined, choices: undefined, kind: "ask", to: ["*"] }))
    expect(everyone?.kind === "question" ? everyone.label : null).toBe("Question for everyone")
  })
})
