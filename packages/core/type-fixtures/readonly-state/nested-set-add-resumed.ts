import { fold, type FoldBase, type Roster } from "../../src/state.ts";

export function join(roster: Roster, base: FoldBase): void {
  const state = fold([], roster, 0, null, null, base);
  state.threadPeople.get(1)?.add("mallory");
}
