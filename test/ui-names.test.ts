import { describe, expect, test } from "bun:test";
import { linked, named } from "../ui/src/chat/linked.ts";

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

  test("an unknown @name and a plain-word handle stay as written", () => {
    expect(linked("@nobody and jow said so", nicknames, tasks)).toBe("@nobody and jow said so");
  });
});
