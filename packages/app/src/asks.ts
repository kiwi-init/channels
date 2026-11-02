import type { PermissionShown } from "@kiwi/core/permission.ts";
import type { DecisionKind, Message } from "@kiwi/core/protocol.ts";
import { holdsWork, type ChannelState } from "@kiwi/core/state.ts";
import { handoffOf } from "./handoff";

export interface AsksForMe {
  decisions: Message[];
  escalations: Message[];
  questions: Message[];
}

const isEscalationTo = (m: Message, me: string) => !!m.esc && !!m.to?.includes(me);

export const heldAsks = (state: Pick<ChannelState, "openAsks" | "tasks" | "askHeads" | "members">): Message[] => state.openAsks.filter((m) => holdsWork(state, m));

export function asksFor(openAsks: Message[], me: string, decides = false): AsksForMe {
  const deciding = (m: Message) => decides && !!m.esc && !m.permission && !m.handoff && !m.step;
  const mine = openAsks.filter((m) => m.from !== me && (m.to?.includes(me) || m.to?.includes("*") || deciding(m)));
  const decisions = mine.filter((m) => (!!m.to?.includes(me) || deciding(m)) && !handoffOf(m));
  const rest = mine.filter((m) => !decisions.includes(m));
  return {
    decisions,
    escalations: rest.filter((m) => isEscalationTo(m, me)),
    questions: rest.filter((m) => !isEscalationTo(m, me)),
  };
}

export function permissionAsks({ decisions, escalations }: Pick<AsksForMe, "decisions" | "escalations">, now: number): { m: Message; p: PermissionShown }[] {
  return [...decisions, ...escalations].flatMap((m) => (m.permission && now <= m.permission.expiresAt ? [{ m, p: m.permission }] : []));
}

const KIND_LABEL: Record<DecisionKind, string> = {
  intent: "Intent check for you",
  taste: "Taste call for you",
  irreversible: "Irreversible step for you",
  scope: "Scope call for you",
  choice: "Decision for you",
};

export const decisionLabel = (m: Pick<Message, "decision" | "step">): string => (m.step ? "A step for you" : m.decision ? KIND_LABEL[m.decision] : "Decision for you");

export function askLabel(m: Message, me: string): string {
  if (isEscalationTo(m, me)) return decisionLabel(m);
  return m.to?.includes(me) ? "Question for you" : "Question for everyone";
}

export interface Chosen {
  choice: string;
  by: string;
  at: number;
}

const letterOf = (choice: string) => /^([A-Z])\s*[:.)-]/.exec(choice)?.[1];

export function choiceIn(body: string, choices: readonly string[]): string | undefined {
  const said = body.trim();
  const exact = choices.find((c) => c.trim() === said);
  if (exact) return exact;
  const letter = /^([A-Z])(?:\s*[:.)-]|\s*$)/.exec(said)?.[1];
  return letter ? choices.find((c) => letterOf(c) === letter) : undefined;
}

export function chosenOf(ask: Message, replies: readonly Message[], deciders: readonly string[] = []): Chosen | undefined {
  if (!ask.choices?.length) return undefined;
  const asked = ask.to ?? [];
  for (const r of replies) {
    if (r.from === ask.from || r.kind === "event" || !r.re?.includes(ask.seq)) continue;
    if (asked.length && !asked.includes("*") && !asked.includes(r.from) && !deciders.includes(r.from)) continue;
    const choice = choiceIn(r.body, ask.choices);
    if (choice) return { choice, by: r.from, at: r.ts };
  }
  return undefined;
}

export function answered(asking: Message | undefined, named: readonly string[], replying: boolean): Message | undefined {
  return !replying && asking && (!named.length || named.includes(asking.from)) ? asking : undefined;
}
