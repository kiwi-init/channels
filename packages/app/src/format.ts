import type { Member } from "@kiwi/core/state.ts";

export function memberName(m: Pick<Member, "name" | "kind" | "display"> | undefined, fallback = ""): string {
  if (!m) return fallback;
  return m.display || m.name;
}
