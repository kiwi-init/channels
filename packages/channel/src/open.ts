import { olderRules, type Message } from "@kiwi/core/protocol.ts";
import type { FoldBase } from "@kiwi/core/state.ts";
import type { OpenedCache } from "./history.ts";
import { planReload } from "./history-plan.ts";
import { baseFrom, newestRules, startsWhole, usableBase } from "./base-plan.ts";
import { keptBaseUpTo, nearUsable, type Kept } from "./kept.ts";
import { heldWindow, type Warm } from "./warm.ts";

export interface Planned {
  messages: Message[];
  unread: number[];
  firstSeq: number | undefined;
  since: number;
}

export interface OpenSteps {
  head: () => Promise<number>;
  roster: () => Promise<void>;
  requests: () => Promise<void>;
  rotate: () => Promise<boolean>;
  cache: () => Promise<OpenedCache | null>;
  tail: (after: number) => Promise<OpenedCache | null>;
  kept: () => Promise<Kept | null>;
  plan: (cache: OpenedCache, head: number) => Promise<Planned | null>;
  snapshot: () => Promise<FoldBase | null>;
  early: (cached: Planned | null, kept: Kept, rest: boolean) => void;
  paint: (cached: Planned | null, base: FoldBase | null, head: number) => void;
}

export interface Opened {
  head: number;
  since: number;
  whole: boolean;
}

export function onceEach(steps: OpenSteps): OpenSteps {
  const memo = <T>(run: () => Promise<T>): (() => Promise<T>) => {
    let kept: Promise<T> | null = null;
    return () =>
      (kept ??= run().catch((err: unknown) => {
        kept = null;
        throw err;
      }));
  };
  return { ...steps, rotate: memo(steps.rotate), cache: memo(steps.cache), kept: memo(steps.kept), snapshot: memo(steps.snapshot) };
}

function provisional(cache: OpenedCache | null, limit: number): Planned | null {
  if (!cache?.opened.length) return null;
  const seqs = cache.opened.map((m) => m.seq);
  const plan = planReload(seqs, Math.max(...seqs), limit);
  const keep = new Set(plan.keep);
  const kept = cache.opened.filter((m) => keep.has(m.seq)).sort((a, b) => a.seq - b.seq);
  if (!kept.length) return null;
  return { messages: kept.filter((m): m is Message => !("unread" in m)), unread: kept.filter((m) => "unread" in m).map((m) => m.seq), firstSeq: kept[0]!.seq, since: plan.since };
}

export function warmUp(steps: OpenSteps, was: Warm | undefined, limit: number): void {
  if (was?.messages.length) return;
  void steps.kept().then(async (kept) => {
    const near = nearUsable(kept);
    const tail = near ? await steps.tail(near.n).catch(() => null) : null;
    const newest = kept && near && tail ? provisional(tail, limit) : null;
    if (kept && near && newest) {
      steps.early(newest, { ...kept, base: near }, true);
      await new Promise((painted) => setTimeout(painted, 0));
    }
    const cache = await steps.cache();
    const first = cache?.opened.length ? Math.min(...cache.opened.map((m) => m.seq)) : undefined;
    const base = was?.base ?? kept?.base ?? null;
    const covered = first === 1 || (base !== null && first !== undefined && base.n >= first - 1);
    if (!covered) void steps.snapshot().catch(() => null);
    if (kept) steps.early(provisional(cache, limit), newest && near ? { ...kept, base: near } : kept, false);
  });
}

export async function openChannel(steps: OpenSteps, was: Warm | undefined, limit: number): Promise<Opened> {
  const rotated = steps.rotate();
  const [, , head] = await Promise.all([steps.roster(), steps.requests(), steps.head()]);
  const held = heldWindow(was, head, limit);
  const opened = held ? null : await steps.cache();
  const cached = opened ? await steps.plan(opened, head) : null;
  const since = held ? held.since : cached ? cached.since : Math.max(0, head - limit);
  const firstSeq = held ? held.firstSeq : cached?.firstSeq;
  const from = baseFrom(since, firstSeq);
  const kept = was?.base ? null : await steps.kept();
  const keptBase = usableBase(keptBaseUpTo(kept, head), from);
  const warm = usableBase(was?.base ?? null, from) ?? keptBase;
  const partial = was?.partial ? was.base : null;
  const snap = (from > 0 && !warm) || (warm !== null && (olderRules(warm) || warm === partial)) ? await steps.snapshot() : null;
  const base = newestRules([usableBase(snap, from), keptBase, warm]);
  steps.paint(cached, base, head);
  if (await rotated) await steps.roster();
  return { head, since, whole: startsWhole(head, limit, since, firstSeq, base === partial ? null : (base ?? warm)) };
}

export function handOver<T extends { seq: number }>(shown: readonly T[], early: ReadonlySet<number>, planned: readonly T[]): T[] {
  const kept = shown.filter((m) => !early.has(m.seq));
  const seen = new Set(kept.map((m) => m.seq));
  return [...kept, ...planned.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq);
}
