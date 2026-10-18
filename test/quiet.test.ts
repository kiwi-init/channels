import { describe, expect, test } from "bun:test";
import { isQuiet, type Event, type Message } from "@kiwi/core/protocol.ts";

const event = (ev: Event): Pick<Message, "kind" | "ev"> => ({ kind: "event", ev });

describe("quiet events", () => {
  test("live state changes stay out of the conversation: notes, leases, claims, reactions, joins, cards", () => {
    const quiet: Event[] = [
      { op: "fact.set", key: "build-lock", value: "ann" },
      { op: "fact.del", key: "build-lock" },
      { op: "lease.take", name: "build", ttl: 600 },
      { op: "lease.free", name: "build" },
      { op: "task.claim", task: 7 },
      { op: "react", seq: 3, emoji: "👍" },
      { op: "hello" },
      { op: "card", os: "macos" },
      { op: "claim", paths: ["src"], ttl: 60 },
      { op: "release" },
    ];
    for (const ev of quiet) expect(isQuiet(event(ev))).toBe(true);
  });

  test("what people need to read stays: tasks moving, roles, the charter, a hold, rooms", () => {
    const loud: Event[] = [
      { op: "task.add", title: "fix the build" },
      { op: "task.update", task: 7, state: "done" },
      { op: "role.set", member: "ann", role: "frontend" },
      { op: "charter.set", text: "Docs only." },
      { op: "hold.set", on: true },
      { op: "room.create", id: "design", name: "design" },
    ];
    for (const ev of loud) expect(isQuiet(event(ev))).toBe(false);
    expect(isQuiet({ kind: "msg" })).toBe(false);
  });
});
