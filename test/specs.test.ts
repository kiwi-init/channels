import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { formatSpec, formatSpecs, planningText } from "@kiwi/core/spec-lines.ts";
import { describeEvent, formatStatus } from "@kiwi/core/format.ts";
import { changedSinceApproval, doneWhen, fold, freeAgents, specLease, specQueue, specStage, specTitle, tickDoneWhen, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { firstPrompt, nextWork, step, workName, workOver } from "../src/loop/work.ts";

const T0 = 1_700_000_000_000;
const ids: Record<string, Identity> = {};
let roster: Roster;

type Draft = Omit<Message, "seq" | "rts" | "sigOk" | "v" | "id" | "ts" | "pk" | "sig">;

async function signedLog(drafts: Draft[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const [i, d] of drafts.entries()) {
    const ts = T0 + i * 1_000;
    const p = await sign(ids[d.from]!, { v: 1 as const, id: crypto.randomUUID(), ts, ...d });
    out.push({ ...p, seq: i + 1, rts: ts, sigOk: await verify(p) } as Message);
  }
  return out;
}

const say = (from: string, body: string, re?: number): Draft => ({ from, kind: "msg", body, ...(re ? { re: [re] } : {}) });
const ev = (from: string, e: Event, re?: number): Draft => ({ from, kind: "event", body: "", ev: e, ...(re ? { re: [re] } : {}) });
const write = (from: string, ask: number, text: string) => ev(from, { op: "spec.set", ask, text });
const approve = (from: string, ask: number, v: number) => ev(from, { op: "spec.approve", ask, v });
const judge = (from: string, ask: number, verdict: "accepted" | "back" | "dropped", note?: string) => ev(from, { op: "spec.result", ask, verdict, ...(note ? { note } : {}) });
const add = (from: string, title: string, re: number) => ev(from, { op: "task.add", title }, re);
const claim = (from: string, task: number) => ev(from, { op: "task.claim", task });
const done = (from: string, task: number) => ev(from, { op: "task.update", task, state: "done" });
const lease = (from: string, name: string) => ev(from, { op: "lease.take", name, ttl: 1800 });

const tickBox = (text: string, words: string): string => {
  const r = tickDoneWhen(text, words);
  if ("why" in r) throw new Error(r.why);
  return r.text;
};

const SPEC = ["# Export annotations as CSV", "", "## Done when", "- [ ] PR merged with ci-ok", "- [ ] Ana OKs a sample file", "", "## Out", "- batch export"].join("\n");

beforeAll(async () => {
  for (const n of ["jow", "ana", "bea", "lead", "dev", "ops"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 0, active: true, kind: "human" },
    { name: "bea", pk: ids.bea!.pk, owner: false, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "ops", pk: ids.ops!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

const at = (s: ChannelState, ask: number) => s.specs.get(ask)!;

describe("a spec: humans and agents write it, a person approves it", () => {
  test("an agent drafts the spec of a person's message, anyone edits it, and each edit is a new version", async () => {
    const log = await signedLog([say("ana", "can we get the labels out as a spreadsheet for Friday?"), write("lead", 1, SPEC), write("bea", 1, `${SPEC}\n- 3D`)]);
    const s = fold(log, roster, T0);
    expect(at(s, 1)).toMatchObject({ ask: 1, v: 3, by: "bea", edits: 2, editors: ["lead", "bea"], started: { seq: 2, by: "lead" } });
    expect(specTitle(at(s, 1), s.askHeads.get(1))).toBe("Export annotations as CSV");
    expect(specStage(s, at(s, 1))).toBe("draft");
  });

  test("a spec belongs to a person's message: an agent's message has none", async () => {
    const log = await signedLog([say("dev", "I'll look at the export"), write("lead", 1, SPEC)]);
    const s = fold(log, roster, T0);
    expect(s.specs.size).toBe(0);
    expect(s.rejected.get(2)).toContain("isn't a person's message");
  });

  test("only who asked, the owner or a person who answers decisions approves, never an agent", async () => {
    const log = await signedLog([say("ana", "export please"), write("lead", 1, SPEC), approve("lead", 1, 2), approve("bea", 1, 2), approve("ana", 1, 2)]);
    const s = fold(log, roster, T0);
    expect(s.rejected.get(3)).toContain("only the person who asked");
    expect(s.rejected.get(4)).toContain("only the person who asked");
    expect(at(s, 1).approved).toMatchObject({ seq: 5, by: "ana", v: 2, text: SPEC });
    const powered = fold(
      log.slice(0, 4),
      roster.map((r) => (r.name === "bea" ? { ...r, answersDecisions: true } : r)),
      T0,
    );
    expect(powered.rejected.get(4)).toBeUndefined();
    expect(powered.specs.get(1)?.approved?.by).toBe("bea");
  });

  test("an approval binds to the version its person read: an edit in between refuses it", async () => {
    const log = await signedLog([say("ana", "export please"), write("lead", 1, SPEC), write("dev", 1, `${SPEC}\n- and PDFs`), approve("ana", 1, 2)]);
    const s = fold(log, roster, T0);
    expect(s.rejected.get(4)).toContain("changed since that version");
    expect(at(s, 1).approved).toBeUndefined();
  });

  test("the events are well formed only with their fields, and a send back needs its note", () => {
    const p = { v: 1, id: "x", from: "ana", kind: "event", body: "", ts: T0 };
    expect(wellFormed({ ...p, ev: { op: "spec.set", ask: 1, text: SPEC } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "spec.set", ask: 1, text: "   " } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "spec.set", ask: 1, text: "a".repeat(20_001) } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "spec.approve", ask: 1, v: 0 } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "spec.result", ask: 1, verdict: "back" } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "spec.result", ask: 1, verdict: "back", note: "the dates are off" } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "spec.result", ask: 1, verdict: "maybe" } })).toBe(false);
  });
});

describe("approved, it starts by itself when an agent is free, and comes back as a result", () => {
  test("draft, queued, working, delivered, accepted: each from what happened, never typed", async () => {
    const ticked = tickBox(tickBox(SPEC, "merged"), "sample");
    const log = await signedLog([
      say("ana", "export please"),
      write("lead", 1, SPEC),
      approve("ana", 1, 2),
      add("dev", "CSV writer", 1),
      claim("dev", 4),
      done("dev", 4),
      write("dev", 1, ticked),
      judge("ana", 1, "accepted"),
      write("dev", 1, `${ticked}\n- one more`),
    ]);
    const stage = (n: number) => {
      const s = fold(log.slice(0, n), roster, T0);
      return specStage(s, s.specs.get(1)!);
    };
    expect([2, 3, 4, 5, 6, 7, 8].map(stage)).toEqual(["draft", "queued", "working", "working", "queued", "delivered", "accepted"]);
    const s = fold(log, roster, T0);
    expect(s.rejected.get(9)).toContain("accepted, so it no longer changes");
    expect(changedSinceApproval(at(s, 1))).toBe(false);
  });

  test("ticking a Done when box isn't a change to the spec; any other edit after approval is, and leaves the queue", async () => {
    const log = await signedLog([
      say("ana", "export please"),
      write("lead", 1, SPEC),
      approve("ana", 1, 2),
      write("dev", 1, tickBox(SPEC, "merged")),
      write("dev", 1, `${SPEC}\n- batch export after all`),
    ]);
    const ticked = fold(log.slice(0, 4), roster, T0);
    expect(changedSinceApproval(at(ticked, 1))).toBe(false);
    expect(specQueue(ticked).map((sp) => sp.ask)).toEqual([1]);
    const drifted = fold(log, roster, T0);
    expect(changedSinceApproval(at(drifted, 1))).toBe(true);
    expect(specQueue(drifted)).toEqual([]);
    expect(formatSpec(drifted, at(drifted, 1))).toContain("approved, then changed: it waits for a person to approve the changes");
  });

  test("sent back with a note, it waits for an agent again, and is delivered only once new work closes", async () => {
    const log = await signedLog([
      say("ana", "export please"),
      write("lead", 1, "# CSV\n- [x] works"),
      approve("ana", 1, 2),
      add("dev", "writer", 1),
      claim("dev", 4),
      done("dev", 4),
      judge("ana", 1, "back", "the dates are off by a day"),
      add("dev", "fix dates", 1),
      claim("dev", 8),
      done("dev", 8),
    ]);
    const stage = (n: number) => {
      const s = fold(log.slice(0, n), roster, T0);
      return specStage(s, s.specs.get(1)!);
    };
    expect([6, 7, 8, 10].map(stage)).toEqual(["delivered", "queued", "working", "delivered"]);
    const s = fold(log.slice(0, 7), roster, T0);
    expect(planningText(s, at(s, 1))).toContain("ana sent it back: “the dates are off by a day”");
  });

  test("a person drops a spec, and its open tasks are set aside for every loop", async () => {
    const log = await signedLog([say("ana", "export please"), write("lead", 1, SPEC), approve("ana", 1, 2), add("dev", "writer", 1), claim("dev", 4), judge("jow", 1, "dropped", "not this quarter")]);
    expect(nextWork(fold(log.slice(0, 5), roster, T0), "dev", 0)).toEqual({ kind: "coding", task: 4 });
    const s = fold(log, roster, T0);
    expect(specStage(s, at(s, 1))).toBe("dropped");
    expect(nextWork(s, "dev", 0)).toBeNull();
    expect(formatSpecs(s)).toBe("no open specs (kiwi specs --all shows accepted and dropped ones)");
    expect(formatSpecs(s, true)).toContain("dropped by jow: not this quarter");
  });

  test("a free seat's loop plans the first approved spec; a lease keeps a second free seat off it, and that seat takes its open task", async () => {
    const log = await signedLog([
      say("ana", "export please"),
      write("lead", 1, SPEC),
      say("bea", "and a dark mode"),
      write("lead", 3, "# Dark mode\n- [ ] it's dark"),
      approve("bea", 3, 4),
      approve("ana", 1, 2),
      lease("dev", specLease(3)),
      add("dev", "dark tokens", 3),
      add("dev", "dark shots", 3),
      claim("dev", 8),
    ]);
    const queued = fold(log.slice(0, 6), roster, T0);
    expect(specQueue(queued).map((sp) => sp.ask)).toEqual([3, 1]);
    expect(freeAgents(queued).sort()).toEqual(["dev", "ops"]);
    expect(nextWork(queued, "dev", 0)).toEqual({ kind: "planning", ask: 3 });
    expect(nextWork(queued, "dev", 2)).toEqual({ kind: "answering" });
    const leased = fold(log.slice(0, 7), roster, T0);
    expect(nextWork(leased, "dev", 0)).toEqual({ kind: "planning", ask: 3 });
    expect(nextWork(leased, "ops", 0)).toEqual({ kind: "planning", ask: 1 });
    expect(firstPrompt({ kind: "planning", ask: 3 }, leased, "dev", "ch")).toContain("This session is for planning it");
    const planned = fold(log, roster, T0);
    expect(workOver({ kind: "planning", ask: 3 }, planned, "dev")).toBe(true);
    expect(step({ kind: "planning", ask: 3 }, planned, "dev", null)).toEqual({ kind: "fresh", work: { kind: "coding", task: 8 }, why: "took" });
    expect(nextWork(planned, "ops", 0)).toEqual({ kind: "coding", task: 9 });
    expect(nextWork(planned, "ops", 0, new Set(["T9"]))).toEqual({ kind: "planning", ask: 1 });
    expect(workName({ kind: "planning", ask: 1 })).toBe("#1's spec");
  });

  test("an agent on hold changes no spec", async () => {
    const log = await signedLog([say("ana", "export please"), ev("jow", { op: "hold.set", on: true }), write("lead", 1, SPEC), write("ana", 1, SPEC)]);
    const s = fold(log, roster, T0);
    expect(s.trust.get(3)).toBe("refused");
    expect(at(s, 1).by).toBe("ana");
  });

  test("a spec lives through the cached base the next fold starts from", async () => {
    const log = await signedLog([say("ana", "export please"), write("lead", 1, SPEC), approve("ana", 1, 2), add("dev", "writer", 1)]);
    let base: FoldBase | null = null;
    fold(log.slice(0, 3), roster, T0, null, null, null, (b) => void (base = b));
    expect(base!.specs?.map((sp) => sp.ask)).toEqual([1]);
    const s = fold(log, roster, T0, base);
    expect(specStage(s, at(s, 1))).toBe("working");
  });

  test("people and agents read where each spec stands", async () => {
    const log = await signedLog([say("ana", "export please"), write("lead", 1, SPEC), approve("ana", 1, 2)]);
    const s = fold(log, roster, T0);
    expect(formatSpecs(s)).toBe("#1 Export annotations as CSV · approved: starts when an agent is free (next; 2 agents are free) · 0/2 done when");
    expect(formatStatus({ alias: "ch", me: "dev", state: s, online: new Map(), unread: 0, now: T0 }) as string).toContain("specs (1 open)");
    expect(describeEvent(log[2]!, s)).toBe("approved the spec of #1: agents start it as soon as one is free");
  });
});

describe("Done when", () => {
  test("its boxes are the ones under a Done when heading, or every box when there's no such heading", () => {
    expect(doneWhen(SPEC)).toEqual([
      { text: "PR merged with ci-ok", done: false },
      { text: "Ana OKs a sample file", done: false },
    ]);
    expect(doneWhen("# x\n- [x] one\n* [ ] two")).toEqual([
      { text: "one", done: true },
      { text: "two", done: false },
    ]);
  });

  test("a box is ticked by a few words of its line, and only when they name one box", () => {
    expect(tickDoneWhen(SPEC, "MERGED")).toEqual({ text: SPEC.replace("- [ ] PR merged", "- [x] PR merged") });
    expect(tickDoneWhen(SPEC, "zzz")).toEqual({ why: "no box in the spec says “zzz”" });
    expect(tickDoneWhen("- [ ] a b\n- [ ] a c", "a")).toEqual({ why: "2 boxes say “a”: use more of the line" });
    expect(tickDoneWhen("- [x] a", "a", false)).toEqual({ text: "- [ ] a" });
  });
});
