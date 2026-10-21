// Where a message sits (T1460): the main conversation, a task's thread, or a direct thread between two
// members. Structure, not secrecy: every place is readable, and older clients see all of it in main.

import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { dmPlace, fold, inGeneral, longForGeneral, placeFromKey, placeKey, threadMembers, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event; re?: number[]; task?: number; dm?: true } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "coord", "dev", "dev2"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "coord", pk: ids.coord!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "dev2", pk: ids.dev2!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

describe("places", () => {
  test("a task's thread, its replies, direct threads, and main", async () => {
    const add = await ev("dev", { op: "task.add", title: "fix the build", owner: "dev" });
    const inTask = await msg("dev", "msg", "on it", { task: add.seq });
    const reply = await msg("dev2", "msg", "need a hand?", { re: [inTask.seq] });
    const dm = await msg("coord", "msg", "how's the build?", { to: ["dev"], dm: true });
    const noTask = await msg("dev", "msg", "which task?", { task: 9999 });
    const wideDm = await msg("coord", "msg", "both of you", { to: ["dev", "dev2"], dm: true });
    const plain = await msg("ana", "msg", "hi all");
    const done = await ev("dev", { op: "task.update", task: add.seq, state: "done" });
    const s = fold([add, inTask, reply, dm, noTask, wideDm, plain, done], roster);
    const at = (m: Message) => placeKey(s.placeOf.get(m.seq)!);
    expect(at(add)).toBe(`task:${add.seq}`);
    expect(at(inTask)).toBe(`task:${add.seq}`);
    // A reply sits where its parent does, whatever it names.
    expect(at(reply)).toBe(`task:${add.seq}`);
    expect(at(dm)).toBe("dm:coord~dev");
    // A task that doesn't exist, or a "dm" to more than one: main.
    expect(at(noTask)).toBe("main");
    expect(at(wideDm)).toBe("main");
    expect(at(plain)).toBe("main");
    expect(at(done)).toBe(`task:${add.seq}`);
    // Listed: main, the task (done, so earlier), the direct thread.
    expect([...s.places.keys()].sort()).toEqual(["dm:coord~dev", "main", `task:${add.seq}`]);
    expect(s.places.get(`task:${add.seq}`)).toMatchObject({ count: 4, done: true, last: done.seq });
    expect(s.places.get("dm:coord~dev")!.count).toBe(1);
  });

  test("who a place is for", async () => {
    const coord = await ev("jon", { op: "role.set", member: "coord", role: "lead" });
    const add = await ev("jon", { op: "task.add", title: "review the docs", owner: "dev", review: "dev2" });
    const s = fold([coord, add], roster);
    expect(threadMembers(s, { kind: "task", task: add.seq }).sort()).toEqual(["coord", "dev", "dev2"]);
    expect(threadMembers(s, dmPlace("dev", "coord"))).toEqual(["coord", "dev"]);
    expect(threadMembers(s, { kind: "main" }).length).toBe(5);
  });

  test("an agent's direct message to a person is a direct thread like any other", async () => {
    const mode = await ev("jon", { op: "mode.set", coordinatorOnly: true, strict: true });
    const toAna = await msg("dev", "msg", "psst", { to: ["ana"], dm: true });
    const s = fold([mode, toAna], roster);
    expect(s.trust.get(toAna.seq)).toBe("verified");
    expect(placeKey(s.placeOf.get(toAna.seq)!)).toBe("dm:ana~dev");
  });

  test("keys round-trip, and the wire fields are checked", () => {
    for (const k of ["main", "task:12", "dm:alice~bob"]) expect(placeKey(placeFromKey(k)!)).toBe(k);
    expect(placeFromKey("room:x")).toBeNull();
    const base = { v: 1, id: "1", from: "dev", kind: "msg", body: "hi", ts: 1 };
    expect(wellFormed({ ...base, task: 12, dm: true })).toBe(true);
    expect(wellFormed({ ...base, task: -1 })).toBe(false);
    expect(wellFormed({ ...base, dm: "yes" })).toBe(false);
  });
});

describe("an agent's long message in #general", () => {
  const long = Array.from({ length: 8 }, (_, i) => `- point ${i + 1}`).join("\n");

  test("past six lines or 600 characters, an agent hears where the detail goes; a person never does", async () => {
    const add = await ev("coord", { op: "task.add", title: "ship it", owner: "dev" });
    const log = [add, await ev("dev", { op: "task.update", task: add.seq, state: "doing" })];
    const s = fold(log, roster);
    expect(longForGeneral(s, "dev", long)).toContain(`kiwi send --to T${add.seq}`);
    expect(longForGeneral(s, "coord", long)).toContain("kiwi send --to T7");
    expect(longForGeneral(s, "dev", "x".repeat(601))).not.toBeNull();
    expect(longForGeneral(s, "dev", "On it as T12.\n\n- one\n- two\n\nShots next.")).toBeNull();
    expect(longForGeneral(s, "dev", `${"x".repeat(600)}\n\n`)).toBeNull();
    expect(longForGeneral(s, "jon", long)).toBeNull();
  });

  test("#general is the main conversation in the general room, not a task's thread, a direct thread or another room", async () => {
    const add = await ev("coord", { op: "task.add", title: "ship it", owner: "dev" });
    const plain = await msg("ana", "msg", "hi all");
    const inTask = await msg("dev", "msg", "on it", { task: add.seq });
    const dm = await msg("coord", "msg", "how's it going?", { to: ["dev"], dm: true });
    const s = fold([add, plain, inTask, dm], roster);
    expect(inGeneral(s, plain.seq)).toBe(true);
    expect(inGeneral(s, inTask.seq)).toBe(false);
    expect(inGeneral(s, dm.seq)).toBe(false);
  });
});
