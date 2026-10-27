import { describe, expect, test } from "bun:test";
import { describeEvent } from "@kiwi/core/format.ts";
import type { Event } from "@kiwi/core/protocol.ts";
import { linked, named, withNames } from "../ui/src/chat/linked.ts";
import { preview } from "../ui/src/chat/preview.ts";

const nicknames = new Map([
  ["cheery-fox", "lead"],
  ["patient-otter", "opus-vm-coder"],
  ["honest-wren", "opus-local-coder"],
  ["jow", "Jow"],
]);
const tasks = new Set([12]);

describe("people read nicknames, never handles", () => {
  test("an @mention reads as the nickname and still points at the member", () => {
    expect(linked("@cheery-fox, can you take T12?", nicknames, tasks)).toBe("[@lead](kiwi-mention:cheery-fox), can you take [T12](kiwi-task:12)?");
  });

  test("a bare handle in prose reads as the nickname too, including a member who has left", () => {
    expect(linked("honest-wren has left; patient-otter keeps the gate.", nicknames, tasks)).toBe(
      "[opus-local-coder](kiwi-mention:honest-wren) has left; [opus-vm-coder](kiwi-mention:patient-otter) keeps the gate.",
    );
  });

  test("code, links, paths and longer words keep the handle as written", () => {
    for (const text of [
      "run `kiwi send --to patient-otter hi`",
      "```\npatient-otter\n```",
      "see [patient-otter](https://example.com/patient-otter)",
      "open patient-otter/src/main.ts",
      "patient-otters and jow-ish",
      "mail patient-otter@example.com",
    ])
      expect(linked(text, nicknames, tasks)).toBe(text);
  });

  test("a plain line, like a task event, reads with nicknames and no links", () => {
    expect(named("added task T12 “Ship it” for patient-otter; review by @cheery-fox", nicknames)).toBe("added task T12 “Ship it” for opus-vm-coder; review by @lead");
    expect(named("run `kiwi send --to patient-otter`", nicknames)).toBe("run `kiwi send --to patient-otter`");
  });

  test("code blocks of every form, reference links and task links next to a word keep what they say", () => {
    for (const text of ["say:\n\n    kiwi send --to patient-otter hi", "> ```\n> patient-otter\n> ```", "see [patient-otter][ref]\n\n[ref]: https://example.com", "``patient-otter ` x``"])
      expect(linked(text, nicknames, tasks)).toBe(text);
    expect(linked("foo.T12 and T12", nicknames, tasks)).toBe("foo.[T12](kiwi-task:12) and [T12](kiwi-task:12)");
  });

  test("a nickname is shown as written, never read as markdown", () => {
    const odd = new Map([["patient-otter", "*lead* `x` [a](b) &amp;"]]);
    expect(linked("ask patient-otter", odd, tasks)).toBe("ask [\\*lead\\* \\`x\\` \\[a\\]\\(b\\) \\&amp;](kiwi-mention:patient-otter)");
    expect(named("ask patient-otter", odd)).toBe("ask *lead* `x` [a](b) &amp;");
  });

  test("an event line names its members by nickname and leaves facts, leases and paths as they were set", () => {
    const nameOf = (handle: string) => nicknames.get(handle) ?? handle;
    const line = (ev: Event) => describeEvent({ v: 1, id: "x", ts: 0, rts: 0, seq: 9, from: "jow", kind: "event", body: "", ev, sigOk: true }, undefined, nameOf);
    expect(line({ op: "task.add", title: "Ship it", owner: "patient-otter", review: "cheery-fox" })).toBe("added task T9 “Ship it” for opus-vm-coder; review by lead");
    expect(line({ op: "task.update", task: 12, owner: "honest-wren" })).toBe("assigned T12 to opus-local-coder");
    expect(line({ op: "fact.set", key: "target", value: "patient-otter" })).toBe("set target = patient-otter");
    expect(line({ op: "lease.free", name: "patient-otter" })).toBe("let go of patient-otter");
    expect(line({ op: "release", paths: ["patient-otter"] })).toBe("released patient-otter");
  });

  test("a line with an entity, an escape or a quote prefix still reads nicknames and links tasks", () => {
    expect(linked("@patient-otter &amp; T12", nicknames, tasks)).toBe("[@opus-vm-coder](kiwi-mention:patient-otter) &amp; [T12](kiwi-task:12)");
    expect(linked("hello \\* @patient-otter T12", nicknames, tasks)).toBe("hello \\* [@opus-vm-coder](kiwi-mention:patient-otter) [T12](kiwi-task:12)");
    expect(linked("> @patient-otter\n> T12", nicknames, tasks)).toBe("> [@opus-vm-coder](kiwi-mention:patient-otter)\n> [T12](kiwi-task:12)");
    expect(linked("| a | b \\| c |\n| - | - |\n| patient-otter | T12 |", nicknames, tasks)).toBe("| a | b \\| c |\n| - | - |\n| [opus-vm-coder](kiwi-mention:patient-otter) | [T12](kiwi-task:12) |");
  });

  test("a preview keeps a nickname exactly as written, even when it looks like markdown", () => {
    const odd = new Map([["patient-otter", "team_ops *lead* [a](b)"]]);
    expect(withNames("**Heads up:** @patient-otter is `ready`", odd, preview)).toBe("Heads up: @team_ops *lead* [a](b) is ready");
  });

  test("an unknown @name and a plain-word handle stay as written", () => {
    expect(linked("@nobody and jow said so", nicknames, tasks)).toBe("@nobody and jow said so");
  });
});
