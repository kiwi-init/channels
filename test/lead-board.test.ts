import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { describeEvent } from "@kiwi/core/format.ts";
import { formatSpec, formatSpecs } from "@kiwi/core/spec-lines.ts";
import { changedSinceApproval, fold, specQueue, specStage, tickDoneWhen, type ChannelState, type Roster } from "@kiwi/core/state.ts";

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

const say = (from: string, body: string): Draft => ({ from, kind: "msg", body });
const ev = (from: string, e: Event, re?: number): Draft => ({ from, kind: "event", body: "", ev: e, ...(re ? { re: [re] } : {}) });
const write = (from: string, ask: number, text: string) => ev(from, { op: "spec.set", ask, text });
const approve = (from: string, ask: number, v: number) => ev(from, { op: "spec.approve", ask, v });
const judge = (from: string, ask: number, verdict: "accepted" | "back" | "dropped", note?: string) => ev(from, { op: "spec.result", ask, verdict, ...(note ? { note } : {}) });
const dropSpec = (from: string, ask: number, why?: string) => ev(from, { op: "spec.delete", ask, ...(why ? { why } : {}) });
const add = (from: string, title: string, re: number, extra: { owner?: string; review?: string } = {}) => ev(from, { op: "task.add", title, ...extra }, re);
const update = (from: string, task: number, change: Omit<Extract<Event, { op: "task.update" }>, "op" | "task">) => ev(from, { op: "task.update", task, ...change });
const remove = (from: string, task: number, why?: string) => ev(from, { op: "task.delete", task, ...(why ? { why } : {}) });

const tick = (text: string, words: string): string => {
  const r = tickDoneWhen(text, words);
  if ("why" in r) throw new Error(r.why);
  return r.text;
};

const SPEC = ["# Export annotations as CSV", "", "## Done when", "- [ ] PR merged with ci-ok", "- [ ] Ana OKs a sample file"].join("\n");
const TICKED = tick(tick(SPEC, "merged"), "sample");

beforeAll(async () => {
  for (const n of ["jow", "ana", "lead", "dev", "ops", "qa"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "ops", pk: ids.ops!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "qa", pk: ids.qa!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

const folded = async (drafts: Draft[]): Promise<ChannelState> => fold(await signedLog(drafts), roster, T0);
const approved = [say("ana", "export please"), write("dev", 1, SPEC), approve("ana", 1, 2)];

describe("the lead cancels, rewrites and deletes any task", () => {
  test("the lead cancels a task under review that only its reviewer may finish; another agent's cancel stays a note", async () => {
    const s = await folded([
      ...approved,
      add("dev", "CSV writer", 1, { owner: "dev", review: "qa" }),
      update("dev", 4, { state: "review" }),
      update("ops", 4, { state: "cancelled", note: "nope" }),
      update("lead", 4, { state: "cancelled", note: "filed twice" }),
    ]);
    const t = s.tasks.get(4)!;
    expect(t).toMatchObject({ state: "done", cancelled: true, closedSeq: 7 });
    expect(t.rounds.at(-1)!.result.kind).toBe("withdrawn");
    expect(t.notes.map((n) => [n.by, n.text])).toEqual([
      ["ops", "nope"],
      ["lead", "filed twice"],
    ]);
  });

  test("a task under review is still finished only by its reviewer, even for the lead", async () => {
    const s = await folded([...approved, add("dev", "CSV writer", 1, { owner: "dev", review: "qa" }), update("dev", 4, { state: "review" }), update("lead", 4, { state: "done" })]);
    expect(s.tasks.get(4)!.state).toBe("review");
    expect(s.rejected.get(6)).toContain("needs review by qa");
  });

  test("the lead and people rewrite a task's body; any other agent is refused", async () => {
    const s = await folded([
      ...approved,
      add("dev", "CSV writer", 1),
      update("ops", 4, { detail: "mine now" }),
      update("lead", 4, { detail: "  write the header row first  " }),
      update("ana", 4, { title: "CSV export", detail: "header, then rows" }),
    ]);
    expect(s.rejected.get(5)).toBe("only a person or the lead rewrites T4's body");
    expect(s.tasks.get(4)).toMatchObject({ title: "CSV export", detail: "header, then rows" });
    const log = await signedLog([...approved, add("dev", "CSV writer", 1), update("lead", 4, { detail: "x" })]);
    expect(describeEvent(log[4]!, s)).toBe("rewrote T4 “CSV export”'s body");
  });

  test("the lead or a person deletes a task: it leaves the board and counts, the history keeps the line, and nothing else changes it after", async () => {
    const log = await signedLog([
      ...approved,
      add("dev", "CSV writer", 1),
      add("dev", "CSV twice", 1),
      remove("ops", 5),
      remove("lead", 5, "filed twice"),
      update("dev", 5, { state: "doing" }),
      remove("jow", 4),
    ]);
    const s = fold(log, roster, T0);
    expect(s.rejected.get(6)).toBe("only a person or the lead deletes T5");
    expect([...s.tasks.keys()]).toEqual([]);
    expect(s.rejected.get(8)).toBe("no task T5");
    expect(s.rejected.has(9)).toBe(false);
    expect(describeEvent(log[6]!, s)).toBe("deleted T5: filed twice");
    expect(log.length).toBe(9);
  });
});

describe("the lead edits, cancels, closes and deletes any spec", () => {
  test("the lead's edit after approval keeps it approved; another agent's edit waits for a person again", async () => {
    const lead = await folded([...approved, write("lead", 1, `${SPEC}\n- [ ] the header row names every column`)]);
    expect(changedSinceApproval(lead.specs.get(1)!)).toBe(false);
    expect(specQueue(lead).map((sp) => sp.ask)).toEqual([1]);
    const dev = await folded([...approved, write("dev", 1, `${SPEC}\n- [ ] the header row names every column`)]);
    expect(changedSinceApproval(dev.specs.get(1)!)).toBe(true);
    const after = await folded([...approved, write("dev", 1, `${SPEC}\n- [ ] more`), write("lead", 1, `${SPEC}\n- [ ] more, and less`)]);
    expect(changedSinceApproval(after.specs.get(1)!)).toBe(true);
  });

  test("the lead cancels a spec, and its open tasks are cancelled with it; done ones stay done", async () => {
    const s = await folded([
      ...approved,
      add("dev", "writer", 1, { owner: "dev" }),
      add("dev", "docs", 1),
      update("dev", 5, { state: "done" }),
      judge("ops", 1, "dropped", "no"),
      judge("lead", 1, "dropped", "not this quarter"),
    ]);
    expect(s.rejected.get(7)).toContain("only the person who asked");
    expect(specStage(s, s.specs.get(1)!)).toBe("dropped");
    expect(s.tasks.get(4)).toMatchObject({ state: "done", cancelled: true, closedSeq: 8 });
    expect(s.tasks.get(4)!.notes.at(-1)).toMatchObject({ by: "lead", text: "cancelled with #1's spec" });
    expect(s.tasks.get(5)).toMatchObject({ state: "done", closedSeq: 6 });
    expect(s.tasks.get(5)!.cancelled).toBeUndefined();
    expect(formatSpecs(s, true)).toContain("dropped by lead: not this quarter");
  });

  test("the lead closes a spec only once every box is ticked, and never sends one back or approves it", async () => {
    const s = await folded([
      say("ana", "export please"),
      write("dev", 1, SPEC),
      approve("lead", 1, 2),
      approve("ana", 1, 2),
      add("dev", "writer", 1),
      judge("lead", 1, "accepted"),
      judge("lead", 1, "back", "dates"),
      write("dev", 1, TICKED),
      judge("lead", 1, "accepted"),
    ]);
    expect(s.rejected.get(3)).toContain("only the person who asked");
    expect(s.rejected.get(6)).toBe("#1's spec has boxes left to tick under Done when: the lead closes it once every one is ticked");
    expect(s.rejected.get(7)).toContain("only the person who asked");
    expect(s.rejected.has(9)).toBe(false);
    expect(s.specs.get(1)!.result).toMatchObject({ verdict: "accepted", by: "lead" });
    expect(s.rejected.get(9)).toBeUndefined();
  });

  test("a spec whose boxes are all ticked closes by itself once its tasks are done", async () => {
    const log = await signedLog([...approved, add("dev", "writer", 1), write("dev", 1, TICKED), update("dev", 4, { state: "done" })]);
    const open = fold(log.slice(0, 5), roster, T0);
    expect(specStage(open, open.specs.get(1)!)).toBe("working");
    const s = fold(log, roster, T0);
    expect(specStage(s, s.specs.get(1)!)).toBe("accepted");
    expect(s.specs.get(1)!.result).toMatchObject({ verdict: "accepted", auto: true, seq: 6 });
    expect(formatSpec(s, s.specs.get(1)!)).toContain("closed by itself: every box ticked and its tasks done");
  });

  test("a spec with its tasks done closes by itself when the last box is ticked", async () => {
    const s = await folded([...approved, add("dev", "writer", 1), update("dev", 4, { state: "done" }), write("dev", 1, tick(SPEC, "merged")), write("dev", 1, TICKED)]);
    expect(s.specs.get(1)!.result).toMatchObject({ verdict: "accepted", auto: true, seq: 7 });
  });

  test("a spec without boxes still waits on a person's verdict", async () => {
    const s = await folded([say("ana", "export please"), write("dev", 1, "# CSV"), approve("ana", 1, 2), add("dev", "writer", 1), update("dev", 4, { state: "done" })]);
    expect(specStage(s, s.specs.get(1)!)).toBe("delivered");
  });

  test("the lead or a person who approves it deletes a spec: off the list, its open tasks cancelled, and a new one can be written", async () => {
    const log = await signedLog([...approved, add("dev", "writer", 1), dropSpec("ops", 1), dropSpec("lead", 1, "wrong ask"), write("dev", 1, "# again")]);
    const s = fold(log, roster, T0);
    expect(s.rejected.get(5)).toBe("only the lead, or a person who approves the spec, deletes it");
    expect(s.tasks.get(4)).toMatchObject({ state: "done", cancelled: true });
    expect(s.specs.get(1)).toMatchObject({ text: "# again", v: 7 });
    expect(s.specs.get(1)!.approved).toBeUndefined();
    expect(describeEvent(log[5]!, s)).toBe("deleted #1's spec: wrong ask");
    const gone = fold(log.slice(0, 6), roster, T0);
    expect(gone.specs.size).toBe(0);
    expect(formatSpecs(gone, true)).toBe("no specs yet");
  });

  test("only well-formed deletes are folded", () => {
    const base = { v: 1 as const, id: "x", ts: T0, from: "lead", kind: "event" as const, body: "", pk: "", sig: "" };
    expect(wellFormed({ ...base, ev: { op: "task.delete", task: 4 } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "task.delete", task: "T4" } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "spec.delete", ask: 0 } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "task.update", task: 4, detail: 7 } })).toBe(false);
  });
});
