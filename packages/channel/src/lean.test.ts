import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts";
import { BODY_KEEP, clipped, leanOf, leanTail } from "./lean.ts";

const msg = (seq: number, more: Partial<Message> = {}): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: seq, seq, sigOk: true, ...more });
const event = (seq: number, ev: Event): Message => msg(seq, { kind: "event", ev, body: "" });
const mentions = (body: string, name: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}_.-])@${name}(?![\\p{L}\\p{N}_-])`, "u").test(body);

describe("a lean copy of a message past the window", () => {
  test("a short body stays as it is; a long one keeps its start and every mention and task named after the cut", () => {
    expect(clipped("hello @jow")).toBe("hello @jow");
    const long = `${"a".repeat(BODY_KEEP)} then @wren.dev asks about T42 and mail@example.com, see T7.`;
    const lean = clipped(long);
    expect(lean.startsWith("a".repeat(BODY_KEEP))).toBe(true);
    expect(lean.length).toBeLessThan(BODY_KEEP + 40);
    expect(mentions(lean, "wren.dev")).toBe(true);
    expect(mentions(lean, "example.com")).toBe(false);
    expect([...lean.matchAll(/\bT(\d+)\b/g)].map((m) => m[1])).toEqual(["42", "7"]);
  });

  test("it drops the image bytes, files and signature, and keeps where the message went and who it was for", () => {
    const m = msg(9, { room: "ops", to: ["jow"], re: [3], side: true, sig: "s".repeat(88), imgs: [{ name: "a.png", mime: "image/png", data: "QUJD" }], files: [] });
    const lean = leanOf(m)!;
    expect(lean).toEqual({ v: PROTOCOL_VERSION, id: "id-9", from: "atlas", kind: "msg", body: "m9", ts: 9, seq: 9, sigOk: true, room: "ops", to: ["jow"], re: [3], side: true });
  });

  test("questions keep their whole text, task and ask events keep their payload, and other events are left out", () => {
    const ask = msg(1, { kind: "ask", body: "x".repeat(BODY_KEEP * 2), choices: ["yes", "no"] });
    expect(leanOf(ask)?.body).toBe(ask.body);
    const update = event(2, { op: "task.update", task: 4, state: "done" });
    expect(leanOf(update)?.ev).toEqual(update.ev);
    expect(leanOf(event(3, { op: "ask.close", ask: 1 }))?.ev).toEqual({ op: "ask.close", ask: 1 });
    expect(leanOf(event(4, { op: "react", seq: 1, emoji: "+1" }))).toBeNull();
  });

  test("the lean tail keeps only the newest copies", () => {
    const tail = leanTail(
      [msg(1), msg(2)].map((m) => leanOf(m)!),
      [msg(3), event(4, { op: "react", seq: 3, emoji: "+1" }), msg(5)],
      3,
    );
    expect(tail.map((m) => m.seq)).toEqual([2, 3, 5]);
  });
});
