/** One pass over an owned channel's join requests. */

import type { Watches } from "@kiwi/channel/watch.ts";

export const TEND_SAFETY_MS = 300_000;

type LetIn = { name: string; sponsor?: { user: string; name: string } };

export interface TendApi {
  autoApprove: (person: string) => Promise<readonly LetIn[]>;
  requests: (opts: { person: string }) => Promise<readonly { id: string; name: string }[]>;
}

export interface Tell {
  title: string;
  ping: (title: string, body: string) => void;
  told: Set<string>;
}

/**
 * Approve own computers' agents, then, given someone to tell, announce whoever is still waiting —
 * including own-computer requests auto-approve did not let in (it threw, or returned none).
 */
export async function tendOwned(person: string, api: TendApi, tell?: Tell): Promise<void> {
  let letIn: readonly LetIn[] = [];
  try {
    letIn = await api.autoApprove(person);
  } catch {
    // Still list remaining requests.
  }
  if (!tell) return;
  const { title, ping, told } = tell;
  const theirs = (m: LetIn) => (m.sponsor && m.sponsor.user !== person ? m.sponsor.name : null);
  const one = letIn[0];
  if (one) {
    const from = theirs(one);
    ping(
      title,
      letIn.length === 1 ? `${one.name} joined from ${from ? `${from}’s computer` : "your computer"}` : letIn.some(theirs) ? `${letIn.length} agents joined` : `${letIn.length} of your agents joined`,
    );
  }
  let remaining: readonly { id: string; name: string }[];
  try {
    remaining = await api.requests({ person });
  } catch {
    return;
  }
  for (const r of remaining) {
    if (told.has(r.id)) continue;
    told.add(r.id);
    ping(title, `${r.name} asks to join`);
  }
}

export function tendOnPush(codes: readonly string[], watch: Watches["watch"], tend: (code: string) => Promise<void>): { kick: (code: string) => void; stop: () => void } {
  const busy = new Map<string, boolean>();
  let stopped = false;
  const kick = (code: string) => {
    if (stopped) return;
    if (busy.has(code)) return void busy.set(code, true);
    busy.set(code, false);
    void tend(code)
      .catch(() => {})
      .finally(() => {
        const again = busy.get(code);
        busy.delete(code);
        if (again) kick(code);
      });
  };
  const stops = codes.map((code) =>
    watch(code, (ev) => {
      if (ev._tag !== "Head") kick(code);
    }),
  );
  return {
    kick,
    stop: () => {
      stopped = true;
      stops.forEach((s) => s());
    },
  };
}
