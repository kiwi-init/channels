import { describe, expect, test } from "bun:test";
import { canonical, generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { REVIEW_SUMMARY_MAX_LENGTH, wellFormedEvent, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { formatTask } from "@kiwi/core/format.ts";
import { fold as foldWith, parseTaskId, type Roster } from "@kiwi/core/state.ts";

/** Everyone a test identity was generated for is a member, unless dropped. */
const roster: Roster = [];
async function member(name: string): Promise<Identity> {
  const id = await generateIdentity(name);
  roster.push({ name, pk: id.pk, owner: false, at: 0, active: true });
  return id;
}
const fold = (ms: Message[], now?: number) => foldWith(ms, roster, now);

let seq = 0;
const T0 = 1_700_000_000_000;

async function msg(id: Identity | null, from: string, init: { kind?: Kind; ev?: Event; to?: string[]; re?: number[]; body?: string; at?: number } = {}): Promise<Message> {
  seq++;
  const at = init.at ?? T0 + seq * 1000;
  const base = {
    v: 1 as const,
    id: crypto.randomUUID(),
    from,
    kind: init.kind ?? (init.ev ? "event" : "msg"),
    body: init.body ?? "",
    ts: at,
    ...(init.to ? { to: init.to } : {}),
    ...(init.re ? { re: init.re } : {}),
    ...(init.ev ? { ev: init.ev } : {}),
  };
  const p = id ? await sign(id, base) : base;
  return { ...p, seq, rts: at, sigOk: await verify(p) };
}

describe("identity", () => {
  test("canonical JSON ignores key order and undefined", () => {
    expect(canonical({ b: 1, a: [{ y: 2, x: undefined, w: "s" }] })).toBe('{"a":[{"w":"s","y":2}],"b":1}');
  });

  test("signatures verify, and break on any change", async () => {
    const id = await generateIdentity("mac");
    const signed = await sign(id, { from: "mac", body: "hi", n: 1 });
    expect(await verify(signed)).toBe(true);
    expect(await verify({ ...signed, body: "hi!" })).toBe(false);
    const other = await generateIdentity("mac");
    expect(await verify({ ...signed, pk: other.pk })).toBe(false);
  });
});

describe("fold", () => {
  test("names are bound by the owner's roster: other keys, unsigned and non-members are forged", async () => {
    const mac = await member("mac");
    const evil = await member("evil");
    const outsider = await generateIdentity("ghost");
    const ms = [
      await msg(mac, "mac", { ev: { op: "hello", role: "capture" } }),
      await msg(evil, "mac", { ev: { op: "fact.set", key: "ip", value: "6.6.6.6" } }),
      await msg(null, "mac", { body: "unsigned, claiming mac" }),
      await msg(outsider, "ghost", { body: "not a member" }),
    ];
    const s = fold(ms);
    expect(ms.map((m) => s.trust.get(m.seq))).toEqual(["verified", "forged", "forged", "forged"]);
    expect(s.facts.size).toBe(0);
    expect(s.members.get("mac")?.persona).toBeUndefined();
    expect(s.members.has("ghost")).toBe(false);
  });

  test("former members' history still verifies", async () => {
    const gone = await generateIdentity("gone");
    const r: Roster = [{ name: "gone", pk: gone.pk, owner: false, at: 0, active: false }];
    const m = await msg(gone, "gone", { body: "said before leaving" });
    expect(foldWith([m], r).trust.get(m.seq)).toBe("verified");
  });

  test("task claim race: the earlier claim wins", async () => {
    const a = await member("a");
    const b = await member("b");
    const add = await msg(a, "a", { ev: { op: "task.add", title: "ship it" } });
    const claimB = await msg(b, "b", { ev: { op: "task.claim", task: add.seq } });
    const claimA = await msg(a, "a", { ev: { op: "task.claim", task: add.seq } });
    const s = fold([add, claimB, claimA]);
    expect(s.tasks.get(add.seq)).toMatchObject({ owner: "b", state: "doing" });
    expect(s.rejected.get(claimA.seq)).toContain("owned by b");
  });

  test("tasks: open, doing, done; dropping one puts it back", async () => {
    const a = await member("a");
    const t1 = await msg(a, "a", { ev: { op: "task.add", title: "protocol" } });
    const t2 = await msg(a, "a", { ev: { op: "task.add", title: "client", owner: "b" } });
    const drop = await msg(a, "a", { ev: { op: "task.update", task: t2.seq, owner: null, note: "free for anyone" } });
    const done = await msg(a, "a", { ev: { op: "task.update", task: t1.seq, state: "done" } });
    const s = fold([t1, t2, drop, done]);
    expect(s.tasks.get(t1.seq)?.state).toBe("done");
    expect(s.tasks.get(t2.seq)).toMatchObject({ owner: undefined, state: "todo" });
    expect(s.tasks.get(t2.seq)?.notes[0]?.text).toBe("free for anyone");
  });

  test("a review round keeps its author's summary, including when the round has no summary", async () => {
    const a = await member("author");
    const add = await msg(a, "author", { ev: { op: "task.add", title: "review summaries" } });
    const first = await msg(a, "author", { ev: { op: "task.update", task: add.seq, state: "review", at: "abc", summary: "Changed the card.\n\nProved it in the smoke run." } });
    const second = await msg(a, "author", { ev: { op: "task.update", task: add.seq, state: "review", at: "def" } });
    const s = fold([add, first, second]);
    expect(s.rejected.size).toBe(0);
    expect(s.tasks.get(add.seq)?.rounds).toMatchObject([
      { n: 1, at: "abc", summary: "Changed the card.\n\nProved it in the smoke run.", result: { kind: "withdrawn" } },
      { n: 2, at: "def", result: { kind: "open" } },
    ]);
    expect(s.tasks.get(add.seq)?.rounds[1]).not.toHaveProperty("summary");
    const formatted = formatTask(s, s.tasks.get(add.seq)!);
    expect(formatted).toContain("Changed the card.");
    expect(formatted).toContain("Proved it in the smoke run.");
    expect(wellFormedEvent({ op: "task.update", task: add.seq, state: "review", summary: "x".repeat(REVIEW_SUMMARY_MAX_LENGTH) })).toBe(true);
    expect(wellFormedEvent({ op: "task.update", task: add.seq, state: "review", summary: "x".repeat(REVIEW_SUMMARY_MAX_LENGTH + 1) })).toBe(false);
    expect(wellFormedEvent({ op: "task.update", task: add.seq, state: "doing", summary: "not a round" })).toBe(false);
    expect(wellFormedEvent({ op: "task.update", task: add.seq, state: "review", summary: "  " })).toBe(false);
  });

  test("older clients' logs still fold: dependencies, needs, blocked, cancelled, handoffs and claims", async () => {
    const a = await member("a");
    const b = await member("b");
    // Events as 0.9 clients sent them, with what's gone since.
    const old = (e: object) => e as unknown as Event;
    const t1 = await msg(a, "a", { ev: old({ op: "task.add", title: "protocol", needs: ["rust"] }) });
    const t2 = await msg(a, "a", { ev: old({ op: "task.add", title: "client", after: [t1.seq], review: "*" }) });
    const claim = await msg(a, "a", { ev: old({ op: "task.claim", task: t2.seq }) });
    const blocked = await msg(a, "a", { ev: old({ op: "task.update", task: t2.seq, state: "blocked", note: "waiting on the protocol" }) });
    const after = await msg(a, "a", { ev: old({ op: "task.update", task: t1.seq, after: [t2.seq] }) });
    const hand = await msg(a, "a", { ev: old({ op: "task.update", task: t1.seq, owner: "b", handoff: { branch: "a/x", files: ["f"] } }) });
    // The doer cancelling a reviewed task: only a note now, so a cancel is never a way around review.
    const cancelled = await msg(a, "a", { ev: old({ op: "task.update", task: t2.seq, state: "cancelled" }) });
    const ca = await msg(a, "a", { ev: { op: "claim", paths: ["src/net"], ttl: 600 } });
    const cb = await msg(b, "b", { ev: { op: "claim", paths: ["src/net/tcp.rs"], ttl: 600 } });
    const rel = await msg(a, "a", { ev: { op: "release" } });
    const log = [t1, t2, claim, blocked, after, hand, cancelled, ca, cb, rel];
    const s = fold(log);
    for (const m of log) {
      expect(s.trust.get(m.seq)).toBe("verified");
      expect(s.rejected.has(m.seq)).toBe(false);
    }
    expect(s.tasks.get(t1.seq)).toMatchObject({ state: "todo", owner: "b" });
    expect(s.tasks.get(t1.seq)).not.toHaveProperty("needs");
    expect(s.tasks.get(t1.seq)).not.toHaveProperty("after");
    expect(s.tasks.get(t2.seq)?.state).toBe("doing");
    expect(s.tasks.get(t2.seq)?.cancelled).toBeUndefined();
    expect(s.tasks.get(t2.seq)?.approvedBy).toBeUndefined();
    expect(s.tasks.get(t2.seq)?.notes.map((n) => n.text)).toEqual(["waiting on the protocol", "cancelled"]);
    expect(s).not.toHaveProperty("claims");
  });

  test("a cancel finishes a task only from whoever may finish it, and says it was cancelled", async () => {
    const doer = await member("doer");
    const reviewer = await member("rev");
    const other = await member("other");
    const reviewed = await msg(doer, "doer", { ev: { op: "task.add", title: "reviewed", review: "rev" } });
    const take = await msg(doer, "doer", { ev: { op: "task.claim", task: reviewed.seq } });
    const byDoer = await msg(doer, "doer", { ev: { op: "task.update", task: reviewed.seq, state: "cancelled", note: "not needed" } });
    let s = fold([reviewed, take, byDoer]);
    expect(s.tasks.get(reviewed.seq)).toMatchObject({ state: "doing" });
    expect(s.tasks.get(reviewed.seq)?.notes.map((n) => n.text)).toEqual(["not needed"]);

    const byReviewer = await msg(reviewer, "rev", { ev: { op: "task.update", task: reviewed.seq, state: "cancelled" } });
    s = fold([reviewed, take, byDoer, byReviewer]);
    expect(s.tasks.get(reviewed.seq)).toMatchObject({ state: "done", cancelled: true });

    // No reviewer: anyone may cancel it; reopening clears the mark, and finishing it plainly never sets it.
    const plain = await msg(other, "other", { ev: { op: "task.add", title: "plain" } });
    const cancel = await msg(other, "other", { ev: { op: "task.update", task: plain.seq, state: "cancelled" } });
    const reopen = await msg(other, "other", { ev: { op: "task.update", task: plain.seq, state: "todo" } });
    const finish = await msg(other, "other", { ev: { op: "task.update", task: plain.seq, state: "done" } });
    expect(fold([plain, cancel]).tasks.get(plain.seq)).toMatchObject({ state: "done", cancelled: true });
    expect(fold([plain, cancel, reopen]).tasks.get(plain.seq)?.cancelled).toBeUndefined();
    expect(fold([plain, cancel, reopen, finish]).tasks.get(plain.seq)).toMatchObject({ state: "done" });
    expect(fold([plain, cancel, reopen, finish]).tasks.get(plain.seq)?.cancelled).toBeUndefined();
  });

  test("open asks close when someone else replies", async () => {
    const a = await member("a");
    const b = await member("b");
    const q1 = await msg(a, "a", { kind: "ask", to: ["b"], body: "ip?" });
    const q2 = await msg(a, "a", { kind: "blocking", body: "need review" });
    const selfReply = await msg(a, "a", { re: [q2.seq], body: "bump" });
    const ans = await msg(b, "b", { re: [q1.seq], body: "10.0.0.2" });
    const s = fold([q1, q2, selfReply, ans]);
    expect(s.openAsks.map((m) => m.seq)).toEqual([q2.seq]);
  });

  test("helpers", () => {
    expect(parseTaskId("T12")).toBe(12);
    expect(parseTaskId("#7")).toBe(7);
    expect(parseTaskId("x")).toBeNull();
  });
});

describe("roles", () => {
  /** A roster where "boss" is the owner and "pixel" joined as a designer. */
  async function channel() {
    const boss = await generateIdentity("boss");
    const pixel = await generateIdentity("pixel");
    const r: Roster = [
      { name: "boss", pk: boss.pk, owner: true, at: 0, active: true },
      { name: "pixel", pk: pixel.pk, owner: false, at: 0, active: true, role: "designer" },
    ];
    return { boss, pixel, r };
  }

  test("an agent's hello sets nothing; only the owner's role.set counts, and an old role.refuse changes nothing", async () => {
    const { boss, pixel, r } = await channel();
    // An older client's hello asking for a role: just an announcement now.
    const ask = await msg(pixel, "pixel", { ev: { op: "hello", role: "reviewer", about: "reads every PR" } });
    let s = foldWith([ask], r);
    expect(s.members.get("pixel")?.persona?.name).toBe("designer");

    // pixel can't grant itself the role.
    const self = await msg(pixel, "pixel", { ev: { op: "role.set", member: "pixel", role: "reviewer" } });
    s = foldWith([ask, self], r);
    expect(s.members.get("pixel")?.persona?.name).toBe("designer");
    expect(s.rejected.get(self.seq)).toBe("only the owner, or a person who manages agents, decides an agent's role");

    const set = await msg(boss, "boss", { ev: { op: "role.set", member: "pixel", role: "reviewer", about: "reads every PR" } });
    const refuse = await msg(boss, "boss", { ev: { op: "role.refuse", member: "pixel" } });
    s = foldWith([ask, self, set, refuse], r);
    expect(s.members.get("pixel")?.persona).toMatchObject({ name: "reviewer", role: "builder", instructions: "reads every PR" });
    expect(s.rejected.has(refuse.seq)).toBe(false);
    const { describeEvent } = await import("@kiwi/core/format.ts");
    const grab = await msg(pixel, "pixel", { ev: { op: "hello", role: "owner" } });
    const st = foldWith([ask, self, set, refuse, grab], r);
    expect(describeEvent(grab, st)).toBe("joined");
    expect(describeEvent(ask, st)).toBe("joined as reviewer (reads every PR)");
  });

  test("an owner's old hello with a role leaves people without one: roles live on agents' personalities", async () => {
    const { boss, r } = await channel();
    const s = foldWith([await msg(boss, "boss", { ev: { op: "hello", role: "coordinator" } })], r);
    expect(s.members.get("boss")?.persona).toBeUndefined();
    expect(s.lead).toBeNull();
  });
});
