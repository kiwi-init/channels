import { fold, type Roster } from "../../src/state.ts";

export function forget(roster: Roster): void {
  const state = fold([], roster);
  state.facts.set("k", { key: "k", value: "changed", by: "mallory", ts: 0, seq: 1 });
}
