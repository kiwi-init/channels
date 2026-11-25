import { fold, type Roster } from "../../src/state.ts";

export function grow(roster: Roster): void {
  fold([], roster, 0, null, null, null, (base) => base.members.push({ name: "mallory", lastSeen: 0, messages: 0 }));
}
