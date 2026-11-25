import { fold, type FoldBase, type Roster } from "../../src/state.ts";

export function forget(roster: Roster, base: FoldBase): void {
  const state = fold([], roster, 0, null, null, base);
  state.facts.set("k", { key: "k", value: "changed", by: "mallory", ts: 0, seq: 1 });
}
