import { describe, expect, test } from "bun:test"

import type { JoinRequest, Member } from "@kiwi/core/membership.ts"
import { PERMISSION_CHOICES, permissionReply } from "@kiwi/core/permission.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"

import { needsOf } from "../../../ios/engine/needs.ts"
import { roomView } from "../../../ios/engine/view.ts"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-jow", name: "Jow" } },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", sponsor: { user: "u-jow", name: "Jow" }, runs: { harness: "claude", model: "opus" } },
]
const members = roster as unknown as Member[]

const msg = (seq: number, from: string, body: string): Message => ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body, ts: seq * 1000 }) as Message
const ev = (seq: number, from: string, e: Event): Message => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev: e, ts: seq * 1000 }) as Message

const permission = {
  v: 1,
  sigOk: true,
  id: "p",
  sig: "sig-p",
  seq: 5,
  from: "dev",
  pk: "pk-dev",
  kind: "blocking",
  body: "Allow?",
  ts: 5000,
  to: ["jow"],
  esc: true,
  choices: [...PERMISSION_CHOICES],
  permission: { tool: "Bash", command: "git push", cwd: "/work", nonce: "n".repeat(32), expiresAt: 9_000_000_000_000, canAllow: true },
} as Message

const view = (log: Message[]) =>
  roomView({
    code: "code",
    title: "channels-dev",
    icon: null,
    me: "jow",
    isOwner: true,
    connection: "live",
    gone: null,
    error: null,
    head: log.length,
    whole: true,
    messages: log,
    state: fold(log, roster, 10_000),
    online: new Map(),
    place: "main",
  })

describe("the phone's Needs you", () => {
  test("an open permission is a need the person can allow, not an option-less question", () => {
    const log = [msg(1, "jow", "ship it"), permission]
    const needs = needsOf(fold(log, roster, 10_000), log, "jow", true, [], members, 10_000)
    expect(needs).toMatchObject([{ kind: "permission", id: "5", from: "dev", canAllow: true, code: expect.stringContaining("git push") }])
    expect(view(log).asks.map((a) => a.seq)).not.toContain(5)
  })

  test("an answered or expired permission leaves Needs you", () => {
    const perm = permissionReply(permission, true, fold([permission], roster, 10_000))
    expect(perm).toBeTruthy()
    const allowed = { ...msg(6, "jow", "Allow once"), to: ["dev"], re: [5], side: true, perm } as Message
    const log = [permission, allowed]
    expect(needsOf(fold(log, roster, 10_000), log, "jow", true, [], members, 10_000).filter((n) => n.kind === "permission")).toEqual([])
    expect(needsOf(fold([permission], roster, 10_000), [permission], "jow", true, [], members, 9_000_000_000_001)).toEqual([])
  })

  test("a spec marked ready asks the owner to approve that version", () => {
    const log = [msg(1, "jow", "export please"), ev(2, "dev", { op: "spec.set", ask: 1, text: "# Export\n\n- [ ] it exports" }), ev(3, "dev", { op: "spec.ready", ask: 1, v: 2 })]
    expect(needsOf(fold(log, roster, 10_000), log, "jow", true, [], members, 10_000)).toMatchObject([{ kind: "spec", ask: 1, v: 2, changed: false, by: "jow" }])
  })

  test("a join request is the owner's to let in, with its code", () => {
    const request = { id: "r1", name: "eager-heron", pk: "pk-new", kind: "agent", ts: 7000, check: "ready", code: "369329" } as unknown as JoinRequest
    expect(needsOf(fold([], roster, 10_000), [], "jow", true, [request], members, 10_000)).toMatchObject([{ kind: "join", id: "r1", name: "eager-heron", who: "agent", code: "369329", pinned: false }])
    expect(needsOf(fold([], roster, 10_000), [], "dev", false, [request], members, 10_000)).toEqual([])
  })
})
