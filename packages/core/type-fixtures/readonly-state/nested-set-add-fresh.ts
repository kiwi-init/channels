import { fold, type Roster } from "../../src/state.ts";

export function join(roster: Roster): void {
  const state = fold([], roster);
  state.threadPeople.get(1)?.add("mallory");
}
