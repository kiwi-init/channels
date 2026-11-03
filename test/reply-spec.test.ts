import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { formatTasks } from "@kiwi/core/format.ts";
import { askRefusal, fold, onSpec, specOfComment, specQueue, specStage, taskSpecRefusal, type Roster } from "@kiwi/core/state.ts";
import { wants } from "../src/agent/wants.ts";
import { nextWork } from "../src/loop/work.ts";

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

beforeAll(async () => {
  for (const n of ["jow", "lead", "dev", "ops"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "ops", pk: ids.ops!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

const ROOT = "# Retire the old features\n\n## Done when\n- [ ] they're gone";
const REPLY = "# Fix the reply spec bug\n\n## Done when\n- [ ] a reply's spec takes tasks";

describe("a spec on a reply takes its own tasks, next to its thread root's own spec", () => {
  const steps: Draft[] = [
    say("jow", "remove what the map retired"),
    ev("jow", { op: "specs.only.set", on: true }),
    ev("lead", { op: "spec.set", ask: 1, text: ROOT }),
    say("jow", "and fix the bug where a reply's spec can't take tasks", 1),
    ev("lead", { op: "spec.set", ask: 4, text: REPLY }),
    ev("jow", { op: "spec.approve", ask: 4, v: 5 }),
    ev("dev", { op: "task.add", title: "file under the reply" }, 4),
    say("ops", "does the board show it under the reply?", 4),
    ev("dev", { op: "task.add", title: "board check" }, 8),
    ev("jow", { op: "spec.approve", ask: 1, v: 3 }),
    ev("lead", { op: "task.add", title: "remove the old map" }, 1),
    say("ops", "which features exactly?", 1),
  ];

  test("an approved spec on a reply takes tasks under that reply, even before the root's spec is approved", async () => {
    const log = await signedLog(steps);
    const s = fold(log, roster, T0);
    expect(s.specsOnly).not.toBeNull();
    expect(s.rejected.get(7)).toBeUndefined();
    expect(s.tasks.get(7)?.ask).toBe(4);
    expect(s.tasks.get(9)?.ask).toBe(4);
    expect(s.tasks.get(11)?.ask).toBe(1);
    const board = formatTasks(s, {});
    expect(board).toContain("#4 jow: “and fix the bug where a reply's spec can't take tasks”");
    expect(board.indexOf("file under the reply")).toBeGreaterThan(board.indexOf("#4 jow"));
    expect(board.indexOf("remove the old map")).toBeLessThan(board.indexOf("#4 jow"));
  });

  test("the root's draft doesn't hold the reply's tasks, and the reply's draft refuses them with its own words", async () => {
    const log = await signedLog(steps.slice(0, 5));
    const s = fold(log, roster, T0);
    expect(taskSpecRefusal(s, { re: 4 })).toBe("#4's spec isn't approved yet: a person approves it, then its tasks are filed");
    expect(askRefusal(s, "dev", { re: 4 }, "--ask N")).toBeNull();
  });

  test("comments, the planning queue and who's on it follow the reply's spec, not the root's", async () => {
    const log = await signedLog(steps);
    const s = fold(log, roster, T0);
    expect(specOfComment(s, 8)?.ask).toBe(4);
    expect(specOfComment(s, 12)?.ask).toBe(1);
    expect([...onSpec(s, 4)].sort()).toEqual(["jow", "lead", "ops"]);
    expect(wants("lead", log[7]!, fold(log.slice(0, 8), roster, T0))).toBe(true);
    expect(wants("lead", log[11]!, fold(log, roster, T0))).toBe(true);
    const approved = fold(log.slice(0, 6), roster, T0);
    expect(specStage(approved, approved.specs.get(4)!)).toBe("queued");
    expect(specQueue(approved).map((sp) => sp.ask)).toEqual([4]);
    expect(nextWork(approved, "dev", 0)).toEqual({ kind: "planning", ask: 4 });
  });
});
