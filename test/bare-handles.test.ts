import { describe, expect, test } from "bun:test";
import { bareHandleNote, fold, type Roster } from "@kiwi/core/state.ts";

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "cheery-fox", pk: "pk-fox", owner: false, at: 0, active: true, kind: "agent", display: "lead" },
  { name: "patient-otter", pk: "pk-otter", owner: false, at: 0, active: true, kind: "agent", display: "opus-vm-coder" },
  { name: "honest-wren", pk: "pk-wren", owner: false, at: 0, active: true, kind: "agent" },
];
const state = fold([], roster, 0);

describe("a bare handle in what an agent sends", () => {
  test("is named once each, with the @handle to write and the nickname people see", () => {
    expect(bareHandleNote(state, "patient-otter continues T88; cheery-fox and patient-otter. review it")).toBe(
      "People see nicknames, not handles: write @patient-otter (opus-vm-coder), @cheery-fox (lead) and the app shows the name. Inside code, keep the bare handle.",
    );
  });

  test("leaves @mentions, code, longer words, handles without a nickname and plain-word handles alone", () => {
    for (const body of [
      "@patient-otter continues",
      "run `kiwi task review T2 --review cheery-fox`",
      "```\nkiwi send --to patient-otter hi\n```",
      "patient-otters and cheery-fox-ish",
      "honest-wren works on the gate",
      "jow said so",
      "mail patient-otter@example.com",
      "open patient-otter/src/main.ts",
      "branch patient-otter/fix-cache",
      "see https://example.com/?q=patient-otter",
      "?q=patient-otter&x=1",
      "say:\n\n    kiwi send --to patient-otter hi",
      "a span ``patient-otter ` x`` here",
      "~~~~\npatient-otter\n~~~~",
    ])
      expect(bareHandleNote(state, body)).toBeNull();
  });
});
