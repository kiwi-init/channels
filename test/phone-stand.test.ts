import { beforeAll, describe, expect, test } from "bun:test";

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

import { askedFor, reportLines, standAsk, standBoard } from "../ios/engine/stand.ts";
import { roomView } from "../ios/engine/view.ts";
import type { RoomView, TaskView } from "../ios/engine/wire.ts";

const T0 = 1_700_000_000_000;
const ids: Record<string, Identity> = {};
let roster: Roster;

type Draft = Omit<Message, "seq" | "rts" | "sigOk" | "v" | "id" | "ts" | "pk" | "sig">;

async function signedLog(drafts: Draft[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const [i, d] of drafts.entries()) {
    const ts = T0 + i * 60_000;
    const p = await sign(ids[d.from]!, { v: 1 as const, id: crypto.randomUUID(), ts, ...d });
    out.push({ ...p, seq: i + 1, rts: ts, sigOk: await verify(p) } as Message);
  }
  return out;
}

const say = (from: string, body: string, more: Partial<Draft> = {}): Draft => ({ from, kind: "msg", body, ...more });
const ev = (from: string, e: Event): Draft => ({ from, kind: "event", body: "", ev: e });
const ask = (label: string): Draft => say("jow", standAsk(label), { to: ["lead"], dm: true });

function view(log: Message[], me: string, place = "main"): RoomView {
  return roomView({
    code: "code",
    title: "channels-dev",
    icon: null,
    me,
    isOwner: me === "jow",
    connection: "live",
    gone: null,
    error: null,
    head: log.length,
    whole: true,
    messages: log,
    state: fold(log, roster, T0 + log.length * 60_000),
    online: new Map(),
    place,
  });
}

beforeAll(async () => {
  for (const n of ["jow", "lead", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
});

describe("pinching a chat asks the lead where things stand (T830)", () => {
  let log: Message[];

  beforeAll(async () => {
    log = await signedLog([
      ev("lead", { op: "task.add", title: "Composer empties after Send", owner: "dev" }),
      ev("dev", { op: "task.update", task: 1, state: "doing" }),
      ev("lead", { op: "task.add", title: "Search across channels" }),
      say("lead", "Hi, ask me anything.", { to: ["jow"], dm: true }),
      ask("#general"),
      say("lead", "**Composer fix is halfway.**\n- **Now:** @dev on T1", { to: ["jow"], dm: true, re: [5] }),
      ask("T1"),
      ask("#general"),
    ]);
  });

  test("the request reads as a plain message any lead can answer, and only it is read back as one", () => {
    const body = standAsk("T1");
    expect(body.startsWith("**Where things stand in T1?**")).toBe(true);
    expect(askedFor({ kind: "msg", to: ["lead"], dm: true, body }, "lead")).toBe("T1");
    expect(askedFor({ kind: "msg", to: ["dev"], dm: true, body }, "lead")).toBeNull();
    expect(askedFor({ kind: "msg", to: ["lead"], dm: true, body: "Where things stand in T1?" }, "lead")).toBeNull();
  });

  test("#general shows the last report at once and that a newer ask is waiting", () => {
    const stand = view(log, "jow").stand;
    expect(stand.label).toBe("#general");
    expect(stand.lead).toBe("lead");
    expect(stand.report?.seq).toBe(6);
    expect(stand.report?.lines).toEqual([
      { text: "Composer fix is halfway.", task: null, seq: null },
      { text: "Now: dev on T1", task: 1, seq: null },
    ]);
    expect(stand.asked?.seq).toBe(8);
  });

  test("a task thread has its own report, apart from #general's", () => {
    const stand = view(log, "jow", "task:1").stand;
    expect(stand.label).toBe("T1");
    expect(stand.report).toBeNull();
    expect(stand.asked?.seq).toBe(7);
    expect(stand.now).toEqual([1]);
    expect(stand.next).toEqual([]);
  });

  test("asks and reports stay out of the lead chat and its preview; other messages there stay", () => {
    const room = view(log, "jow");
    expect(room.side.map((m) => m.seq)).toEqual([4]);
    expect(room.places.find((p) => p.key === room.sideKey)?.last?.seq).toBe(4);
  });

  test("the lead sees the asks as plain messages and has no report page of its own", () => {
    const room = view(log, "lead", "dm:jow~lead");
    expect(room.messages.map((m) => m.seq)).toEqual([4, 5, 6, 7, 8]);
    expect(room.stand.lead).toBeNull();
    expect(room.stand.report).toBeNull();
  });

  test("a report reads as plain lines: no markdown, code left out, each line pointing at its task or message", () => {
    const body = "## **Release is close.**\n\n- **Now:** [T12](https://x) is green, see #40\n```\nbun test\n```\n> **Next:** `T15`";
    expect(
      reportLines(body, (t) =>
        t
          .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+)/, "")
          .replace(/\*\*|`|\[|\]\([^)]*\)/g, "")
          .trim(),
      ),
    ).toEqual([
      { text: "Release is close.", task: null, seq: null },
      { text: "Now: T12 is green, see #40", task: 12, seq: 40 },
      { text: "Next: T15", task: 15, seq: null },
    ]);
  });

  test("the board picks a chat's tasks: all in #general, one in its thread, a person's in a direct chat", () => {
    const t = (id: number, state: TaskView["state"], owner: string | null): TaskView => ({
      id,
      title: `t${id}`,
      state,
      owner,
      review: null,
      updatedAt: 0,
      createdAt: 0,
      last: null,
      archived: false,
      since: null,
    });
    const tasks = [t(1, "doing", "dev"), t(2, "review", "lead"), t(3, "todo", null), t(4, "done", "dev")];
    expect(standBoard(tasks, { kind: "all" })).toEqual({ now: [1, 2], next: [3], done: [4] });
    expect(standBoard(tasks, { kind: "task", task: 2 })).toEqual({ now: [2], next: [], done: [] });
    expect(standBoard(tasks, { kind: "owner", owner: "dev" })).toEqual({ now: [1], next: [], done: [4] });
    expect(standBoard(tasks, { kind: "none" })).toEqual({ now: [], next: [], done: [] });
  });
});
