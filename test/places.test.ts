// Where a message sits (T1460): the main conversation, a task's thread, or a direct thread between two
// members. Structure, not secrecy: every place is readable, and older clients see all of it in main.

import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { dmPlace, firstAgent, fold, placeFromKey, placeKey, threadMembers, type Roster } from "@kiwi/core/state.ts";

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
    const coord = await ev("jon", { op: "role.set", member: "coord", role: "coordinator" });
    const add = await ev("jon", { op: "task.add", title: "review the docs", owner: "dev", review: "dev2" });
    const s = fold([coord, add], roster);
    expect(threadMembers(s, { kind: "task", task: add.seq }).sort()).toEqual(["coord", "dev", "dev2"]);
    expect(threadMembers(s, dmPlace("dev", "coord"))).toEqual(["coord", "dev"]);
    expect(threadMembers(s, { kind: "main" }).length).toBe(5);
  });

  test("a direct message to a person still obeys strict coordinator-only", async () => {
    const coord = await ev("jon", { op: "role.set", member: "coord", role: "coordinator" });
    const mode = await ev("jon", { op: "mode.set", coordinatorOnly: true, strict: true });
    const toAna = await msg("dev", "msg", "psst", { to: ["ana"], dm: true });
    const fromCoord = await msg("coord", "msg", "update for you", { to: ["ana"], dm: true });
    const s = fold([coord, mode, toAna, fromCoord], roster);
    expect(s.trust.get(toAna.seq)).toBe("refused");
    expect(placeKey(s.placeOf.get(fromCoord.seq)!)).toBe("dm:ana~coord");
    expect(s.places.has("dm:ana~dev")).toBe(false);
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

describe("who coordinates by default", () => {
  test("only the owner's own agent, by sign-in: never someone else's, and nobody where nobody is signed in", () => {
    const jon = { user: "user_jon", name: "Jon" };
    const signed: Roster = [
      { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: jon },
      { name: "dev", pk: ids.dev!.pk, owner: false, at: 1, active: true, kind: "agent", sponsor: { user: "user_eve", name: "Eve" } },
      { name: "dev2", pk: ids.dev2!.pk, owner: false, at: 2, active: true, kind: "agent", sponsor: jon },
    ];
    // dev joined first, but it's Eve's agent: dev2, Jon's own, coordinates.
    expect(firstAgent(fold([], signed))).toBe("dev2");
    expect(
      firstAgent(
        fold(
          [],
          signed.filter((m) => m.name !== "dev2"),
        ),
      ),
    ).toBeUndefined();
    // No sign-in, so nobody provably the owner's.
    expect(firstAgent(fold([], roster))).toBeUndefined();
  });
});
