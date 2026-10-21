import { expect, test } from "bun:test";
import type { TerminalsStatus } from "@kiwi/core/terminals.ts";
import { terminalsOf } from "../desktop/src/terminals-status.ts";

test("Settings reads kiwi terminal status --json, keeps only terminals it knows, and anything else as no group", () => {
  const known: TerminalsStatus = {
    prefer: "rex",
    launch: "on",
    terminals: [
      { id: "rex", name: "Rex", found: true, running: true, helpers: "on" },
      { id: "tmux", name: "tmux", found: true, running: true, helpers: null },
      { id: "app", name: "Terminal", found: true, running: true, helpers: null },
    ],
  };
  const raw = { ...known, terminals: [...known.terminals, { id: "moon", name: "Moon", found: true, running: true, helpers: "on" }] };
  expect(terminalsOf(JSON.stringify(raw))).toEqual(known);
  expect(terminalsOf(JSON.stringify({ ...known, prefer: "moon" }))).toBeNull();
  expect(terminalsOf(JSON.stringify({ ...known, launch: "maybe" }))).toBeNull();
  expect(terminalsOf("kiwi: not a channel")).toBeNull();
});
