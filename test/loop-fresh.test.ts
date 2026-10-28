import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { askFresh, clearFresh, freshAsked } from "../src/loop/fresh.ts";
import { firstPrompt, step } from "../src/loop/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
const dir = mkdtempSync(join(tmpdir(), "kiwi-fresh-"));
const before = process.env.KIWI_HOME;
beforeAll(async () => {
  process.env.KIWI_HOME = dir;
  for (const n of ["jon", "ana"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
});
afterAll(() => {
  if (before === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = before;
  rmSync(dir, { recursive: true, force: true });
});

describe("a fresh session per task, and a restart point inside one (#1118)", () => {
  test("a session for messages that takes on a task ends, so the task gets a session of its own", async () => {
    const add = await ev("jon", { op: "task.add", title: "fix it" });
    const claim = await ev("ana", { op: "task.claim", task: add.seq });
    expect(step({ kind: "answering" }, fold([add], roster), "ana", null)).toEqual({ kind: "keep", work: { kind: "answering" } });
    expect(step({ kind: "answering" }, fold([add, claim], roster), "ana", null)).toEqual({ kind: "fresh", work: { kind: "coding", task: add.seq }, why: "took" });
  });

  test("a coding session that asked for a fresh start from its checkpoint ends; the same task comes next", async () => {
    const add = await ev("jon", { op: "task.add", title: "long one", owner: "ana" });
    const state = fold([add], roster);
    const coding = { kind: "coding", task: add.seq } as const;
    expect(step(coding, state, "ana", null)).toEqual({ kind: "keep", work: coding });
    expect(step(coding, state, "ana", add.seq + 1)).toEqual({ kind: "keep", work: coding });
    expect(step(coding, state, "ana", add.seq)).toEqual({ kind: "fresh", work: coding, why: "checkpoint" });
    const done = await ev("jon", { op: "task.update", task: add.seq, state: "done" });
    expect(step(coding, fold([add, done], roster), "ana", add.seq)).toEqual({ kind: "over" });
  });

  test("the prompts say so: a coding session can ask for a fresh start, a session for messages ends once it takes a task", async () => {
    const add = await ev("jon", { op: "task.add", title: "long one", owner: "ana" });
    const state = fold([add], roster);
    expect(firstPrompt({ kind: "coding", task: add.seq }, state, "ana", "ch")).toContain(`task checkpoint T${add.seq} --fresh --file note.md`);
    expect(firstPrompt({ kind: "answering" }, state, "ana", "ch")).toContain("if you take on a task, end your turn once it's yours, and a fresh session starts for it");
  });

  test("the ask is the seat's, on this machine, and counts only from the session's start", () => {
    askFresh("ch", "ana", 7, 1_000);
    expect(freshAsked("ch", "ana", 500)).toBe(7);
    expect(freshAsked("ch", "ana", 2_000)).toBeNull();
    expect(freshAsked("ch", "bo", 500)).toBeNull();
    clearFresh("ch", "ana");
    expect(freshAsked("ch", "ana", 500)).toBeNull();
  });
});
