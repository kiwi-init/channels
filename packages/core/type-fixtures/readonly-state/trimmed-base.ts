import type { Message } from "../../src/protocol.ts";
import type { Roster } from "../../src/state.ts";
import { trimmed } from "../../../channel/src/trim.ts";

export function grow(messages: Message[], roster: Roster): void {
  const base = trimmed(messages, roster, 0, null, null, null, 10);
  if (base) base.facts.push({ key: "k", value: "v", by: "mallory", ts: 0, seq: 1 });
}
