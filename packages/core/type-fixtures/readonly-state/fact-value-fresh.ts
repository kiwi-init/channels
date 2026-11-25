import { fold, type Roster } from "../../src/state.ts";

export function rewrite(roster: Roster): void {
  const state = fold([], roster);
  const fact = state.facts.get("k");
  if (fact) fact.value = "changed";
}
