import { describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { directsOf, messagesOf, theirsOf } from "~/live/map"
import { spotOf } from "~/live/pictures"

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Message[] = []

async function join(name: string, kind: "human" | "agent"): Promise<void> {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner: kind === "human", at: 0, active: true, kind })
}

async function dm(from: string, to: string, body: string): Promise<void> {
  const id = ids.get(from)
  if (!id) throw new Error(`no identity for ${from}`)
  const seq = log.length + 1
  const signed = await sign(id, { v: 1 as const, id: String(seq), from, kind: "msg", body, ts: seq * 1000, to: [to], dm: true })
  log.push({ ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) })
}

await join("jow", "human")
await join("atlas", "agent")
await join("win", "agent")
await dm("jow", "atlas", "take ridge's task")
await dm("atlas", "win", "can you review the installer after?")
await dm("win", "atlas", "yes, send the PR")
const state = fold(log, roster)
const none = { get: (seq: number, i: number, alt: string) => spotOf(undefined, `${seq}:${i}`, alt) }

describe("other members' direct messages, read-only (T652)", () => {
  test("their DMs are listed once per pair, apart from yours", () => {
    expect(directsOf(state, log, "jow", {}).map((d) => d.with)).toEqual(["atlas"])
    expect(theirsOf(state, log, "jow")).toEqual([{ between: ["atlas", "win"], last: 3000 }])
  })

  test("their messages stay in the feed, in their own place", () => {
    const shown = messagesOf(state, log, "jow", new Map(), none, [])
    expect(shown.map((m) => m.where)).toEqual([
      { kind: "dm", with: "atlas" },
      { kind: "theirs", between: ["atlas", "win"] },
      { kind: "theirs", between: ["atlas", "win"] },
    ])
  })

  test("a member of the pair sees it as their own DM", () => {
    expect(theirsOf(state, log, "atlas")).toEqual([])
    expect(
      directsOf(state, log, "atlas", {})
        .map((d) => d.with)
        .sort()
    ).toEqual(["jow", "win"])
  })
})
