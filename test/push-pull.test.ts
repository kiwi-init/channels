import { beforeAll, describe, expect, test } from "bun:test";
import { wants } from "../src/agent.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, init: { kind?: Kind; ev?: Event; room?: string; re?: number[]; to?: string[]; body?: string; task?: number; esc?: true } = {}): Promise<Message> {
  seq++;
  const { kind, body, ...rest } = init;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: kind ?? (init.ev ? "event" : "msg"), body: body ?? "", ...rest, ts: seq });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ann", "bob", "cat"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 1, active: true, kind: "agent", sponsor: { user: "u_jon", name: "Jon" } },
    { name: "bob", pk: ids.bob!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "cat", pk: ids.cat!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

describe("what an agent is sent", () => {
  test("all of #general that goes to everyone, an agent's posts included; not what's sent to someone else", async () => {
    const news = await msg("ann", { body: "deployed 0.18 to staging" });
    const s = fold([news], roster);
    expect(wants("bob", news, s)).toBe(true);
    expect(wants("cat", news, s)).toBe(true);
    expect(wants("ann", news, s)).toBe(false);
    const toBob = await msg("ann", { to: ["bob"], body: "bob, a quick one" });
    expect(wants("cat", toBob, fold([news, toBob], roster))).toBe(false);
  });

  test("a room only once you've posted in it; until then you read it with log --room", async () => {
    const create = await msg("jon", { ev: { op: "room.create", id: "design01", name: "design" } });
    const first = await msg("ann", { room: "design01", body: "new icon set" });
    const s = fold([create, first], roster);
    expect(wants("bob", first, s)).toBe(false);
    const joined = await msg("bob", { room: "design01", body: "looks good" });
    const next = await msg("ann", { room: "design01", body: "shipping it" });
    const after = fold([create, first, joined, next], roster);
    expect(wants("bob", next, after)).toBe(true);
    expect(wants("cat", next, after)).toBe(false);
    expect(after.rooms.get("design01")!.posters).toEqual(["ann", "bob"]);
  });

  test("an @mention reaches you anywhere: another task's thread, a room you never posted in", async () => {
    const add = await msg("jon", { ev: { op: "task.add", title: "fix the build", owner: "ann" } });
    const create = await msg("jon", { ev: { op: "room.create", id: "design01", name: "design" } });
    const inTask = await msg("ann", { task: add.seq, body: "@cat can you check the lockfile?" });
    const inRoom = await msg("ann", { room: "design01", body: "@Cat thoughts on the icon?" });
    const notCat = await msg("ann", { task: add.seq, body: "mail cat@example.com about it" });
    const s = fold([add, create, inTask, inRoom, notCat], roster);
    expect(wants("cat", inTask, s)).toBe(true);
    expect(wants("cat", inRoom, s)).toBe(true);
    expect(wants("cat", notCat, s)).toBe(false);
    expect(wants("bob", inTask, s)).toBe(false);
  });

  test("a task's thread reaches whoever asked in it, so an answer posted there isn't lost", async () => {
    const add = await msg("jon", { ev: { op: "task.add", title: "push or pull" } });
    const ask = await msg("ann", { kind: "blocking", task: add.seq, to: ["jon"], esc: true, body: "A, B or C?" });
    const answer = await msg("jon", { task: add.seq, body: "A" });
    const s = fold([add, ask, answer], roster);
    expect(s.tasks.get(add.seq)!.posters).toEqual(["ann", "jon"]);
    expect(wants("ann", answer, s)).toBe(true);
    expect(wants("bob", answer, s)).toBe(false);
  });

  test("a mention is a name after an @ that starts a word, any case, trailing punctuation aside", async () => {
    const reaches = async (body: string) => {
      const m = await msg("ann", { to: ["jon"], body });
      return wants("cat", m, fold([m], roster));
    };
    for (const body of ["@cat look", "see #12 (@Cat).", "ok @cat-"]) expect(await reaches(body)).toBe(true);
    for (const body of ["cat@example.com", "path/@cat/pkg", "./@cat", "@catalog"]) expect(await reaches(body)).toBe(false);
  });
});
