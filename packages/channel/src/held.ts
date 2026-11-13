import type { HumanSession } from "@kiwi/core/client.ts";
import type { StoredMember } from "./store.ts";

export interface Holdable {
  open(): () => void;
  serve(as: "full" | "light"): void;
}

export interface Hold<S> {
  store: S;
  use: (light: boolean) => () => void;
}

interface Entry<S> {
  store: S;
  seat: string;
  human: HumanSession | null | undefined;
  light: boolean;
  users: number;
  full: number;
  close: (() => void) | null;
  ends: number;
}

const seatOf = (m: StoredMember): string => JSON.stringify([m.code, m.relay ?? null, m.identity, m.access]);

export function makeHolds<S extends Holdable>(
  create: (member: StoredMember, human: HumanSession | null | undefined, light: boolean) => S,
  later: (run: () => void) => void = (run) => void setTimeout(run, 0),
): { hold: (member: StoredMember, human: HumanSession | null | undefined, light: boolean) => Hold<S>; live: (code: string) => S[] } {
  const held = new Map<string, Entry<S>[]>();
  const add = (code: string, e: Entry<S>) => {
    const here = held.get(code) ?? [];
    if (!here.includes(e)) held.set(code, [...here, e]);
  };
  const drop = (code: string, e: Entry<S>) => {
    const left = (held.get(code) ?? []).filter((x) => x !== e);
    if (left.length) held.set(code, left);
    else held.delete(code);
  };
  const end = (code: string, e: Entry<S>) => {
    const at = ++e.ends;
    later(() => {
      if (e.users > 0 || at !== e.ends) return;
      e.close?.();
      e.close = null;
      drop(code, e);
    });
  };
  const hold = (member: StoredMember, human: HumanSession | null | undefined, light: boolean): Hold<S> => {
    const seat = seatOf(member);
    const here = (held.get(member.code) ?? []).filter((e) => e.seat === seat && e.human === human);
    const found = here.find((e) => !e.light) ?? (light ? here.find((e) => e.light) : undefined);
    const entry = found ?? { store: create(member, human, light), seat, human, light, users: 0, full: 0, close: null, ends: 0 };
    add(member.code, entry);
    const serve = () => entry.store.serve(entry.full > 0 || (!entry.light && entry.users === 0) ? "full" : "light");
    return {
      store: entry.store,
      use: (asLight) => {
        add(member.code, entry);
        entry.users++;
        if (!asLight) entry.full++;
        serve();
        entry.close ??= entry.store.open();
        let used = true;
        return () => {
          if (!used) return;
          used = false;
          entry.users--;
          if (!asLight) entry.full--;
          serve();
          if (entry.users === 0) end(member.code, entry);
        };
      },
    };
  };
  return { hold, live: (code) => (held.get(code) ?? []).flatMap((e) => (e.close ? [e.store] : [])) };
}
