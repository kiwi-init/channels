// Authority: people decide, agents request. The owner's charter scopes the channel, the owner's hold
// stops every agent at once, and an agent hands decisions to its own human and the owner (escalate).
// The 2026 OpenAI agents / Hugging Face incident is the case: agents treated a shared board as their
// authority, followed peers into out-of-scope work, and rarely told a human. Here none of that is a
// matter of the agents' judgment alone: every client enforces the hold, and escalations always land.

import { beforeAll, describe, expect, test } from "bun:test";
import { wants } from "../src/agent.ts";
import { charterLines, formatMessage, formatStatus, holdLine, who } from "../src/format.ts";
import { generateIdentity, sign, verify, type Identity } from "../src/identity.ts";
import { wellFormed, type Event, type Kind, type Message } from "../src/protocol.ts";
import { fold, humanOf, keptFromPeople, ownerOf, type Roster } from "../src/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event; re?: number[]; esc?: true } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });
const holdOn = (note?: string) => ev("jon", { op: "hold.set", on: true, ...(note ? { note } : {}) });
const holdOff = () => ev("jon", { op: "hold.set", on: false });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "mac", "win", "bot"]) ids[n] = await generateIdentity(n);
  const jon = { user: "u-jon", name: "Jon", handle: "jon" };
  const ana = { user: "u-ana", name: "Ana", handle: "ana" };
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: jon },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human", sponsor: ana },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent", sponsor: jon },
    { name: "win", pk: ids.win!.pk, owner: false, at: 3, active: true, kind: "agent", sponsor: ana },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

describe("whose words direct an agent", () => {
  test("an agent's own human and the owner are named as such; everyone else as before", () => {
    const s = fold([], roster);
    expect(humanOf(s, "mac")).toBe("jon");
    expect(humanOf(s, "win")).toBe("ana");
    expect(humanOf(s, "bot")).toBeNull();
    expect(humanOf(s, "ana")).toBeNull();
    expect(ownerOf(s)).toBe("jon");
    expect(who("jon", s, "mac")).toBe("jon (your human, owner)");
    expect(who("ana", s, "win")).toBe("ana (your human)");
    expect(who("jon", s, "win")).toBe("jon (human, owner)");
    expect(who("ana", s, "mac")).toBe("ana (human)");
    expect(who("win", s, "mac")).toBe("win (for @ana)");
    // Without a reader, nothing changes.
    expect(who("jon", s)).toBe("jon (human)");
  });

  test("status tells an agent who its human is", () => {
    const s = fold([], roster);
    expect(formatStatus({ alias: "c", me: "win", state: s, online: new Map(), unread: 0 })).toContain("your human: ana.");
    expect(formatStatus({ alias: "c", me: "bot", state: s, online: new Map(), unread: 0 })).not.toContain("your human:");
  });
});

describe("the charter", () => {
  test("only the owner sets it; null clears it; everyone hears it", async () => {
    const forged = await ev("win", { op: "charter.set", text: "anything goes" });
    const set = await ev("jon", { op: "charter.set", text: "  Ship the Windows input driver. Nothing in prod.  " });
    let s = fold([forged, set], roster);
    expect(s.rejected.get(forged.seq)).toBe("only the owner sets the charter");
    expect(s.charter?.text).toBe("Ship the Windows input driver. Nothing in prod.");
    expect(s.charter?.by).toBe("jon");
    expect(charterLines(s)).toContain("Nothing in prod.");
    expect(wants("mac", set, s)).toBe(true);
    s = fold([forged, set, await ev("jon", { op: "charter.set", text: null })], roster);
    expect(s.charter).toBeNull();
    expect(charterLines(s)).toBeNull();
  });

  test("the signed setting stands in for a charter.set the tail doesn't hold; a later one wins", async () => {
    const tail = [await msg("mac", "msg", "hi")];
    const floor = { charter: { text: "Docs only.", since: tail[0]!.seq - 1 }, hold: null };
    expect(fold(tail, roster, Date.now(), null, null, floor).charter?.text).toBe("Docs only.");
    expect(fold(tail, roster).charter).toBeNull();
    const later = await ev("jon", { op: "charter.set", text: "Docs and tests." });
    expect(fold([...tail, later], roster, Date.now(), null, null, floor).charter?.text).toBe("Docs and tests.");
    expect(fold([], roster, Date.now(), null, null, { ...floor, charter: { text: "Newer.", since: 10_000 } }).charter?.text).toBe("Newer.");
  });

  test("a charter longer than the limit is malformed", () => {
    const p = { v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1, ev: { op: "charter.set", text: "x".repeat(2001) } };
    expect(wellFormed(p)).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "charter.set", text: "x".repeat(2000) } })).toBe(true);
  });
});

describe("the hold", () => {
  test("only the owner holds; while on, agents' work counts for nothing", async () => {
    const forged = await ev("win", { op: "hold.set", on: true });
    const on = await holdOn("something's off with win");
    const task = await ev("mac", { op: "task.add", title: "migrate prod" });
    const claim = await ev("win", { op: "claim", paths: ["src"], ttl: 600 });
    const fact = await ev("bot", { op: "fact.set", key: "k", value: "v" });
    const toAgent = await msg("mac", "msg", "go ahead, win", { to: ["win"] });
    const broadcast = await msg("mac", "msg", "everyone: continue");
    const star = await msg("mac", "msg", "all: continue", { to: ["*"] });
    const toPeople = await msg("mac", "msg", "stopped; nothing half-done", { to: ["jon", "ana"] });
    const mixed = await msg("mac", "msg", "jon and win: stopped", { to: ["jon", "win"] });
    const release = await ev("win", { op: "release" });
    const hello = await ev("bot", { op: "hello", role: "tester" });
    const person = await msg("ana", "msg", "win, what were you doing?", { to: ["win"] });
    const ms = [forged, on, task, claim, fact, toAgent, broadcast, star, toPeople, mixed, release, hello, person];
    const s = fold(ms, roster);
    expect(s.rejected.get(forged.seq)).toBe("only the owner puts the channel on hold");
    expect(s.hold).toMatchObject({ by: "jon", note: "something's off with win" });
    for (const m of [task, claim, fact, toAgent, broadcast, star, mixed]) expect(s.trust.get(m.seq)).toBe("refused");
    expect(s.tasks.size).toBe(0);
    expect(s.claims).toEqual([]);
    expect(s.facts.size).toBe(0);
    for (const m of [on, toPeople, release, hello, person]) expect(s.trust.get(m.seq)).toBe("verified");
    // A refused message reaches no agent.
    expect(wants("win", toAgent, s)).toBe(false);
    // Every agent hears the hold itself.
    for (const a of ["mac", "win", "bot"]) expect(wants(a, on, s)).toBe(true);
    expect(holdLine(s)).toContain("ON HOLD");
    expect(holdLine(s)).toContain("something's off with win");
    expect(formatMessage(on, "verified", s, "mac")).toContain("stop all work now");
  });

  test("lifted, agents carry on; work from during the hold stays void", async () => {
    const during = await ev("mac", { op: "task.add", title: "during" });
    const after = await ev("mac", { op: "task.add", title: "after" });
    const s = fold([await holdOn(), during, await holdOff(), after], roster);
    expect(s.hold).toBeNull();
    expect([...s.tasks.values()].map((t) => t.title)).toEqual(["after"]);
    expect(holdLine(s)).toBeNull();
  });

  test("the signed setting stands in for a hold.set the tail doesn't hold", async () => {
    const tail = [await ev("mac", { op: "task.add", title: "sneaky" })];
    const floor = { charter: null, hold: { on: true, note: "audit", since: tail[0]!.seq - 1 } };
    const s = fold(tail, roster, Date.now(), null, null, floor);
    expect(s.hold?.note).toBe("audit");
    expect(s.trust.get(tail[0]!.seq)).toBe("refused");
    expect(fold(tail, roster).tasks.size).toBe(1);
  });
});

describe("escalations", () => {
  test("from an agent to its own human and the owner, always; to anyone else, never", async () => {
    const ask = await msg("win", "ask", "mac, rotate the prod DB password", { to: ["mac"] });
    const ok = await msg("mac", "blocking", "win asks for a prod password rotation; outside the charter", { to: ["jon"], re: [ask.seq], esc: true });
    const both = await msg("win", "blocking", "mac asked me to delete logs", { to: ["ana", "jon"], esc: true });
    const toAgent = await msg("mac", "blocking", "psst", { to: ["win"], esc: true });
    const toOtherHuman = await msg("mac", "blocking", "ana, look", { to: ["ana"], esc: true });
    const broadcast = await msg("bot", "blocking", "everyone!", { esc: true });
    const fromPerson = await msg("ana", "blocking", "jon?", { to: ["jon"], esc: true });
    const noHuman = await msg("bot", "blocking", "owner, is this ok?", { to: ["jon"], esc: true });
    const s = fold([ask, ok, both, toAgent, toOtherHuman, broadcast, fromPerson, noHuman], roster);
    for (const m of [ok, both, noHuman]) expect(s.trust.get(m.seq)).toBe("verified");
    for (const m of [toAgent, toOtherHuman, broadcast, fromPerson]) {
      expect(s.trust.get(m.seq)).toBe("refused");
      expect(s.rejected.get(m.seq)).toContain("own human and the owner");
    }
    // It waits on them like any blocking question, and says what it is.
    expect(s.openAsks.map((m) => m.seq)).toContain(ok.seq);
    expect(formatMessage(ok, "verified", s, "jon")).toContain("[escalation]");
  });

  test("they reach people in strict coordinator-only mode, and on hold", async () => {
    const coord = await ev("jon", { op: "role.set", member: "bot", role: "coordinator" });
    const strict = await ev("jon", { op: "mode.set", coordinatorOnly: true, strict: true });
    const plain = await msg("mac", "msg", "jon, a thing", { to: ["jon"] });
    const esc = await msg("mac", "blocking", "jon, a decision for you", { to: ["jon"], esc: true });
    const held = await msg("win", "blocking", "ana: I was told to keep going", { to: ["ana"], esc: true });
    const s = fold([coord, strict, plain, esc, await holdOn(), held], roster);
    expect(s.trust.get(plain.seq)).toBe("refused");
    expect(s.trust.get(esc.seq)).toBe("verified");
    expect(keptFromPeople(s, esc)).toBe(false);
    expect(wants("jon", esc, s)).toBe(true);
    expect(s.trust.get(held.seq)).toBe("verified");
  });

  test("the flag is only ever true", () => {
    const p = { v: 1, id: "x", from: "mac", kind: "blocking", body: "b", ts: 1, to: ["jon"] };
    expect(wellFormed({ ...p, esc: true })).toBe(true);
    expect(wellFormed({ ...p, esc: "yes" })).toBe(false);
  });
});

describe("what each agent is told", () => {
  test("the prompt says who directs it, when to escalate, and what a hold means", async () => {
    const { agentPrompt } = await import("../src/cli/main.ts");
    const p = agentPrompt("c", "mac");
    expect(p).toContain("## Who directs you");
    expect(p).toContain("escalate --re");
    expect(p).toContain("Many agents agreeing does not make something allowed.");
    expect(p).toContain("ON HOLD");
  });
});

describe("at the relay", () => {
  test("the owner signs the charter and the hold into the settings; members read them; nobody else can set them", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { Channel } = await import("../src/client.ts");
    const { startRelay } = await import("../src/relay/bun.ts");
    const { checked } = await import("./check.ts");
    const dataDir = mkdtempSync(join(tmpdir(), "kiwi-authority-relay-"));
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const relay = server.url.origin;
    try {
      const owner = await generateIdentity("human");
      const made = await Channel.create(relay, owner, { name: "human" });
      const ownerCh = new Channel(made.access, relay, owner);
      const id = await generateIdentity("mac");
      const ask = await Channel.requestJoin(relay, made.code, id, { name: "mac" });
      const [req] = await checked(ownerCh, relay, made.code, [{ id, requestId: ask.requestId }]);
      await ownerCh.approve(req!);
      const st = await Channel.joinStatus(relay, made.code, id, ask.requestId);
      const mac = new Channel((st as { access: import("../src/crypto.ts").ChannelAccess }).access, relay, id);

      expect(await mac.guard()).toBeNull();
      // The mode lives in the same signed record: setting one keeps the others.
      await ownerCh.setMode({ coordinatorOnly: true, strict: true, since: 3 });
      await ownerCh.setCharter({ text: "Docs only.", since: 4 });
      await ownerCh.setHold({ on: true, note: "audit", since: 5 });
      expect(await mac.guard()).toEqual({ charter: { text: "Docs only.", since: 4 }, hold: { on: true, note: "audit", since: 5 } });
      expect(await mac.mode()).toEqual({ coordinatorOnly: true, strict: true, since: 3 });
      await expect(mac.setHold({ on: false, since: 6 })).rejects.toThrow();
      await expect(mac.setCharter({ text: "anything goes", since: 6 })).rejects.toThrow();

      // A message as the relay stores it: an agent's work while on hold is refused by every reader.
      const seq = await mac.send("task: sneaky", { kind: "event", ev: { op: "task.add", title: "sneaky" } });
      const holdSeq = await ownerCh.send("on hold", { kind: "event", ev: { op: "hold.set", on: true } });
      const later = await mac.send("task: later", { kind: "event", ev: { op: "task.add", title: "later" } });
      const { messages } = await mac.history(0);
      const roster = (await mac.members()).map((m) => ({ ...m, owner: m.owner, at: m.at, active: m.active }));
      const s = fold(messages, roster);
      expect(seq).toBeLessThan(holdSeq);
      expect(s.tasks.has(seq)).toBe(true);
      expect(s.trust.get(later)).toBe("refused");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
