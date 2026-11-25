import { expect, test } from "bun:test";
import { PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { measureBase } from "../scripts/perf-base.ts";

const T0 = 1_700_000_000_000;
const OWNER = "o".repeat(43);
const roster: Roster = [{ name: "jow", pk: OWNER, owner: true, at: 0, active: true, kind: "human" }];
const at = (seq: number, body: string, ev?: Event, re?: number): Message => ({
  v: PROTOCOL_VERSION,
  id: `m${seq}`,
  from: "jow",
  kind: ev ? "event" : "msg",
  body,
  ...(ev ? { ev } : {}),
  ...(re ? { re: [re] } : {}),
  ts: T0 + seq,
  rts: T0 + seq,
  seq,
  sigOk: true,
  pk: OWNER,
});

function baseOf(messages: Message[]): FoldBase {
  let base: FoldBase | null = null;
  fold(messages, roster, T0 + 1000, null, null, undefined, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

test("the base's size is its UTF-8 JSON, so text beyond ASCII counts every byte it takes", () => {
  const base = baseOf([at(1, "hi"), at(2, "task", { op: "task.add", title: "éééé" })]);
  const ascii = measureBase(baseOf([at(1, "hi"), at(2, "task", { op: "task.add", title: "aaaa" })]), 400);
  const wide = measureBase(base, 400);
  expect(wide.bytes).toBe(new TextEncoder().encode(JSON.stringify(base)).length);
  expect(wide.bytes).toBeGreaterThan(JSON.stringify(base).length);
  expect(wide.bytes - ascii.bytes).toBe(JSON.stringify(base).split("é").length - 1);
  expect(ascii.window).toBe(400);
  expect(ascii.mb).toBe(Math.round((ascii.bytes / 1048576) * 100) / 100);
});

test("the mix counts tasks, their notes and the message maps, and its shares add up to the whole", () => {
  const m = measureBase(
    baseOf([
      at(1, "hi"),
      at(2, "task", { op: "task.add", title: "one", owner: "jow" }),
      at(3, "note", { op: "task.update", task: 2, note: "a note" }),
      at(4, "note", { op: "task.update", task: 2, note: "another" }),
      at(5, "a reply", undefined, 1),
    ]),
    400,
  );
  expect(m.n).toBe(5);
  expect(m.counts).toMatchObject({ tasks: 1, taskNotes: 2, githubPrs: 0, githubRuns: 0 });
  expect(m.counts.threadOf).toBeGreaterThan(0);
  const sum = m.shares.tasks! + m.shares.github! + m.shares.messageMaps! + m.shares.rest!;
  expect(Math.abs(sum - 100)).toBeLessThan(1);
});
