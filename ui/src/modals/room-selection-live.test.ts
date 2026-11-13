import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fold, rosterOf } from "@kiwi/core/state.ts"
import { startRelay } from "../../../src/relay/bun.ts"
import { joinAgent, pairComputer, setupChannel } from "../../../test/owner.ts"
import { peopleOf } from "../live/map.ts"
import { roomSelection } from "./room-selection.ts"

test("an unchanged room-settings save keeps effective membership with departed stored names (#2388)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "room-settings-"))
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir })
  try {
    const s = await setupChannel(server.url.origin)
    const computer = await pairComputer(s.person)
    const active = await joinAgent(s, "active", computer)
    const departed = await joinAgent(s, "departed", computer)
    const pick = (who: typeof active) => {
      if (!who.id.xpk) throw new Error("missing room encryption key")
      return { name: who.id.name, pk: who.id.pk, xpk: who.id.xpk }
    }
    const id = await s.ownerCh.makeRoom("settings-members", [pick(active), pick(departed)])
    await s.ownerCh.remove(departed.id.pk)
    const roster = await s.ownerCh.members()
    const state = fold((await s.ownerCh.history(0)).messages, rosterOf(roster))
    const stored = state.rooms.get(id)?.members?.map((m) => m.name) ?? []
    expect(stored).toContain("departed")
    const channel = { you: s.owner.name, people: peopleOf(state, roster, new Map(), s.owner.name, new Map()) }
    const names = roomSelection(channel, stored)
    expect(names).toEqual(["active"])
    const selected = names.map((name) => {
      const member = roster.find((r) => r.active && r.name === name)
      if (!member || !member.xpk) throw new Error("selected member is unavailable")
      return { name, pk: member.pk, xpk: member.xpk }
    })
    expect(await s.ownerCh.changeRoom(id, { members: selected })).toBe(true)
    const saved = fold((await s.ownerCh.history(0)).messages, rosterOf(await s.ownerCh.members()))
    expect(
      saved.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort()
    ).toEqual([s.owner.name, "active"].sort())
    expect(await s.ownerCh.changeRoom(id, { members: selected })).toBe(false)
  } finally {
    server.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)
