import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { describeEvent } from "@kiwi/core/format.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function put(from: string, p: Partial<Payload>): Promise<Message> {
  seq++;
  const signed = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "msg" as const, body: "", ts: seq, ...p } as Payload);
  return { ...signed, seq, rts: seq, sigOk: await verify(signed) };
}
const ev = (from: string, e: Event) => put(from, { kind: "event", ev: e });
const on = (from = "jon") => ev(from, { op: "asks.tap.set", on: true });
const ask = (extra: Partial<Payload> = {}) => put("win", { kind: "ask", esc: true, to: ["jon"], body: "Ship the redesign to everyone?", choices: ["A: everyone", "B: behind a setting"], ...extra });
const reply = (to: Message, body: string, extra: Partial<Payload> = {}) => put("jon", { re: [to.seq], to: [to.from], body, ...extra });
const open = (log: Message[], q: Message) => fold(log, roster).openAsks.some((a) => a.seq === q.seq);

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "owl", "win"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("the op and the field are well formed (T509)", () => {
  test("asks.tap.set takes on/off; pick rides only on a reply", () => {
    const base = { v: 1 as const, id: "x", from: "jon", body: "A", ts: 1, sig: "s", pk: "p" };
    expect(wellFormed({ ...base, kind: "event", ev: { op: "asks.tap.set", on: true } })).toBe(true);
    expect(wellFormed({ ...base, kind: "event", ev: { op: "asks.tap.set", on: "yes" } })).toBe(false);
    expect(wellFormed({ ...base, kind: "msg", re: [4], pick: true })).toBe(true);
    expect(wellFormed({ ...base, kind: "msg", pick: true })).toBe(false);
    expect(wellFormed({ ...base, kind: "msg", re: [4], pick: false })).toBe(false);
  });

  test("the event reads as words", async () => {
    expect(describeEvent(await on())).toContain("answers by tap");
  });
});

describe("off by default: a typed reply answers, as before", () => {
  test("a reply in the chat closes a person's decision", async () => {
    const q = await ask();
    const log = [q, await reply(q, "A and B")];
    expect(fold(log, roster).tapToAnswer).toBe(false);
    expect(open(log, q)).toBe(false);
  });
});

describe("on: a typed reply under a decision doesn't close it", () => {
  test("the reply stays a reply and the ask stays open, until a tap from the card", async () => {
    const switched = await on();
    const q = await ask();
    const typed = await reply(q, "A and B");
    expect(open([switched, q, typed], q)).toBe(true);
    expect(open([switched, q, typed, await reply(q, "A: everyone", { pick: true, side: true })], q)).toBe(false);
  });

  test("words typed into the card count as a tap, and so does a step's own answer", async () => {
    const switched = await on();
    const q = await ask({ choices: undefined });
    expect(open([switched, q, await reply(q, "Both, A first", { pick: true })], q)).toBe(false);
    const step = await put("win", { kind: "ask", esc: true, to: ["jon"], body: "Test it on your panel", holds: [], step: { why: "CI has none", needsPerson: "eyes", do: ["Open the app"] } });
    expect(open([switched, step, await reply(step, "Done", { stepReply: { kind: "done" } })], step)).toBe(false);
  });

  test("the asker restates it: closing the old ask works, and the new one closes on one tap", async () => {
    const switched = await on();
    const q = await ask();
    const typed = await reply(q, "A and B");
    const close = await ev("win", { op: "ask.close", ask: q.seq, why: "restated" });
    const again = await ask({ choices: ["A: A and B, as you said"], re: [typed.seq] });
    const log = [switched, q, typed, close, again];
    expect(open(log, q)).toBe(false);
    expect(open(log, again)).toBe(true);
    expect(open([...log, await reply(again, "A: A and B, as you said", { pick: true })], again)).toBe(false);
  });

  test("an agent's plain question, not a person's decision, still closes on a typed reply", async () => {
    const switched = await on();
    const q = await put("win", { kind: "ask", body: "Which branch is the release on?" });
    expect(open([switched, q, await put("owl", { re: [q.seq], to: ["win"], body: "main" })], q)).toBe(false);
  });

  test("a reply typed before the switch went on still answered", async () => {
    const q = await ask();
    const typed = await reply(q, "A");
    expect(open([q, typed, await on()], q)).toBe(false);
  });
});

describe("only the owner turns it on, and it survives a restart", () => {
  test("the lead's switch is refused", async () => {
    const byLead = await on("owl");
    const s = fold([byLead], roster);
    expect(s.tapToAnswer).toBe(false);
    expect(s.rejected.has(byLead.seq)).toBe(true);
  });

  test("folding from a kept base keeps the setting and the open ask", async () => {
    const switched = await on();
    const q = await ask();
    const all = [switched, q, await reply(q, "A and B")];
    for (const cut of [1, 2]) {
      const made: FoldBase[] = [];
      fold(all.slice(0, cut), roster, Date.now(), null, null, null, (b) => void made.push(b));
      const resumed = fold(all.slice(cut), roster, Date.now(), null, null, made.at(-1)!);
      expect(resumed.tapToAnswer).toBe(true);
      expect(resumed.openAsks.some((a) => a.seq === q.seq)).toBe(true);
    }
  });
});
