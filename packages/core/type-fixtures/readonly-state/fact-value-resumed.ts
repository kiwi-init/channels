import { fold, type FoldBase, type Roster } from "../../src/state.ts";

export function rewrite(roster: Roster, base: FoldBase): void {
  const state = fold([], roster, 0, null, null, base);
  const fact = state.facts.get("k");
  if (fact) fact.value = "changed";
}
