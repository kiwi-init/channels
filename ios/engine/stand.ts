import type { Message } from "@kiwi/core/protocol.ts";

import type { StandView, TaskView } from "./wire.ts";

export const STAND_AGAIN_MS = 2 * 60_000;
const ASKED = /^\*\*Where things stand in (.+?)\?\*\*/;
const BOARD_ROWS = 5;

export type StandScope = { kind: "all" } | { kind: "task"; task: number } | { kind: "owner"; owner: string } | { kind: "none" };

export function standAsk(label: string): string {
  return [
    `**Where things stand in ${label}?**`,
    `Asked by pinching that chat on the phone. Reply to this message with a short report on ${label} only:`,
    "- one line on top: where it stands",
    "- **Now:** who works on what, how far",
    "- **Done** lately",
    "- **Needs you:** what waits on me",
    "- **Next**",
    "Name tasks as T<N> and messages as #<N>.",
  ].join("\n");
}

export function askedFor(m: Pick<Message, "kind" | "to" | "dm" | "body">, lead: string): string | null {
  if (m.kind !== "msg" || !m.dm || m.to?.length !== 1 || m.to[0] !== lead) return null;
  return ASKED.exec(m.body)?.[1] ?? null;
}

export interface Stands {
  asks: ReadonlyMap<number, string>;
  answers: ReadonlyMap<number, number>;
}

export function standsIn(messages: readonly Message[], lead: string | null, mine: (name: string) => boolean): Stands {
  const asks = new Map<number, string>();
  const answers = new Map<number, number>();
  if (!lead) return { asks, answers };
  for (const m of messages) {
    const label = mine(m.from) ? askedFor(m, lead) : null;
    if (label) {
      asks.set(m.seq, label);
      continue;
    }
    if (m.from !== lead || m.kind === "event") continue;
    const ask = m.re?.find((seq) => asks.has(seq));
    if (ask !== undefined) answers.set(m.seq, ask);
  }
  return { asks, answers };
}

export const hiddenBy = (stands: Stands) => (m: Pick<Message, "seq">) => stands.asks.has(m.seq) || stands.answers.has(m.seq);

export function standBoard(tasks: readonly TaskView[], scope: StandScope): Pick<StandView, "now" | "next" | "done"> {
  const scoped = tasks.filter((t) => (scope.kind === "all" ? true : scope.kind === "task" ? t.id === scope.task : scope.kind === "owner" ? t.owner === scope.owner : false));
  const ids = (states: readonly TaskView["state"][]) =>
    scoped
      .filter((t) => states.includes(t.state))
      .slice(0, BOARD_ROWS)
      .map((t) => t.id);
  return { now: ids(["doing", "review"]), next: ids(["todo"]), done: ids(["done"]) };
}

export function standView(
  label: string,
  lead: string | null,
  stands: Stands,
  messages: readonly Message[],
  said: (text: string) => string,
  board: Pick<StandView, "now" | "next" | "done">,
): StandView {
  const ours = new Set([...stands.asks].filter(([, l]) => l === label).map(([seq]) => seq));
  const answer = messages.findLast((m) => ours.has(stands.answers.get(m.seq) ?? -1));
  const answered = new Set(stands.answers.values());
  const ask = messages.findLast((m) => ours.has(m.seq));
  const waiting = ask && !answered.has(ask.seq) && (!answer || ask.seq > answer.seq) ? ask : undefined;
  return {
    label,
    lead,
    asked: waiting ? { seq: waiting.seq, at: waiting.rts ?? waiting.ts } : null,
    report: answer ? { seq: answer.seq, at: answer.rts ?? answer.ts, shown: said(answer.body) } : null,
    ...board,
  };
}
