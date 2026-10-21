import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { askGroups, askRefusal, fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { formatStatus, formatTasks } from "@kiwi/core/format.ts";

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

const say = (from: string, body: string, more: Partial<Draft> = {}): Draft => ({ from, kind: "msg", body, ...more });
const ev = (from: string, e: Event, more: Partial<Draft> = {}): Draft => ({ from, kind: "event", body: "", ev: e, ...more });
const add = (title: string, more: Partial<Extract<Event, { op: "task.add" }>> = {}, re?: number) => ev("lead", { op: "task.add", title, ...more }, re !== undefined ? { re: [re] } : {});

function baseOf(messages: Message[]): FoldBase {
  let base: FoldBase | null = null;
  fold(messages, roster, T0, null, null, null, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

const asks = (s: ChannelState) => Object.fromEntries([...s.tasks.values()].map((t) => [t.id, t.ask ?? null]));

beforeAll(async () => {
  for (const n of ["jow", "lead", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

describe("tasks are filed under the ask they serve", () => {
  let log: Message[];

  beforeAll(async () => {
    log = await signedLog([
      say("jow", "UI ideas so we can keep up"),
      say("jow", "Screenshot 1.png"),
      add("explore an agent tree", {}, 1),
      add("explore a delegate board", {}, 2),
      say("lead", "which one first?", { re: [1] }),
      add("compare the two", {}, 5),
      say("jow", "only the board, please", { task: 3 }),
      add("trim the board", {}, 7),
      add("a follow-up", { from: 4 }),
      say("dev", "found a bug in task who"),
      add("fix task who", { from: 4 }, 10),
      add("an agent's own finding", {}, 10),
      ev("jow", { op: "task.add", title: "jow's own task" }),
      add("from an older client"),
      ev("lead", { op: "task.update", task: 3, state: "done" }),
    ]);
  });

  test("by the person's message, a reply in its chain, its task's thread, or the task it comes from", () => {
    const s = fold(log, roster, T0 + 60_000);
    expect(asks(s)).toEqual({ 3: 1, 4: 2, 6: 1, 8: 1, 9: 2, 11: 2, 12: null, 13: 13, 14: null });
    expect(s.askHeads.get(1)).toEqual({ id: 1, by: "jow", words: "UI ideas so we can keep up", at: T0 });
    expect(s.askHeads.has(10)).toBe(false);
    expect(s.askHeads.get(13)).toMatchObject({ by: "jow", words: "jow's own task" });
    expect(s.tasks.get(3)?.state).toBe("done");
    expect(s.tasks.get(14)?.state).toBe("todo");
  });

  test("folding from a kept base files them the same as one fold from the start", () => {
    const whole = fold(log, roster, T0 + 60_000);
    for (const cut of [2, 5, 7, 10, 13]) {
      const resumed = fold(log.slice(cut), roster, T0 + 60_000, null, null, baseOf(log.slice(0, cut)));
      expect(asks(resumed)).toEqual(asks(whole));
      expect(formatTasks(resumed, { all: true })).toBe(formatTasks(whole, { all: true }));
    }
  });

  test("the board groups by ask, oldest ask first, unfiled work last", () => {
    const s = fold(log, roster, T0 + 60_000);
    const open = [...s.tasks.values()].filter((t) => t.state !== "done");
    expect(askGroups(s, open).map((g) => [g.head?.id ?? null, g.tasks.map((t) => t.id)])).toEqual([
      [1, [6, 8]],
      [2, [4, 9, 11]],
      [13, [13]],
      [null, [12, 14]],
    ]);
    expect(formatTasks(s).split("\n")).toEqual([
      "#1 jow: “UI ideas so we can keep up”",
      "  T6    open      compare the two",
      "  T8    open      trim the board",
      "#2 jow: “Screenshot 1.png”",
      "  T4    open      explore a delegate board",
      "  T9    open      a follow-up",
      "  T11   open      fix task who",
      "#13 jow: “jow's own task”",
      "  T13   open      jow's own task",
      "unfiled (no person's message holds these)",
      "  T12   open      an agent's own finding",
      "  T14   open      from an older client",
    ]);
    const status = formatStatus({ alias: "dev", me: "lead", state: s, online: new Map(), unread: 0, now: T0 + 60_000 });
    expect(status).toContain("tasks (8 open, 1 done), by the ask each serves:\n  #1 jow: “UI ideas so we can keep up”\n    T6    open      compare the two");
  });
});

describe("adding a task without an ask", () => {
  test("is refused for an agent with the fix named, and allowed for a person, whose task is its own ask", async () => {
    const log = await signedLog([say("jow", "ship it"), say("dev", "found a bug"), ev("jow", { op: "task.add", title: "look at dev's bug" }, { re: [2] })]);
    const s = fold(log, roster, T0 + 60_000);
    const fix = "--ask N or --from T7";
    expect(askRefusal(s, "lead", {}, fix)).toBe(`a task is filed under the ask it serves: ${fix}`);
    expect(askRefusal(s, "lead", { re: 2 }, fix)).toBe(`#2 isn't a person's message or a reply under one, so no ask holds it: ${fix}`);
    expect(askRefusal(s, "lead", { re: 1 }, fix)).toBeNull();
    expect(askRefusal(s, "lead", { re: 2, from: 3 }, fix)).toBeNull();
    expect(askRefusal(s, "lead", { issue: true }, fix)).toBeNull();
    expect(askRefusal(s, "jow", {}, fix)).toBeNull();
    expect(s.tasks.get(3)?.ask).toBe(3);
  });
});

describe("the kept base stays bounded", () => {
  test("a person's old message survives the cut only while a task is filed under it", async () => {
    const filler = Array.from({ length: 5_100 }, (_, i) => say("dev", `note ${i}`));
    const log = await signedLog([say("jow", "ship it"), say("jow", "and nothing else"), add("ship", {}, 1), ...filler]);
    const base = baseOf(log);
    expect(base.askHeads?.map((h) => h.id)).toEqual([1]);
    const resumed = fold([], roster, T0, null, null, base);
    expect(resumed.tasks.get(3)?.ask).toBe(1);
    expect(resumed.askHeads.get(1)?.words).toBe("ship it");
  });
});
