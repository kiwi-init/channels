import { LEASE_WAIT_MS } from "./leases.ts";
import type { ChannelState } from "./types.ts";

export function nextExpiry(state: Pick<ChannelState, "openAsks" | "facts" | "leases">, now: number): number | null {
  let next = Infinity;
  const at = (t: number): void => {
    if (t > now && t < next) next = t;
  };
  for (const m of state.openAsks) if (m.permission) at(m.permission.expiresAt + 1);
  for (const f of state.facts.values()) if (f.expires !== undefined) at(f.expires);
  for (const l of state.leases.values()) {
    if (l.holder) at(l.until);
    for (const q of l.queue) at(q.joined + LEASE_WAIT_MS);
  }
  return next === Infinity ? null : next;
}
