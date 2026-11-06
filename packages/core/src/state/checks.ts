import { choiceIn, type CheckArtifact, type CheckAsk, type CheckPhase } from "../checks.ts";
import { heldBefore, inOrderOfHappening, trustedAt } from "./times.ts";

interface CheckAnswer {
  choice: string;
  pass: boolean;
  by: string;
  seq: number;
  at?: number;
}

export interface CheckState {
  seq: number;
  by: string;
  phase: CheckPhase;
  decider: string;
  artifact: CheckArtifact;
  choices: string[];
  holds: number[];
  replaces?: number;
  askedAt?: number;
  answer?: CheckAnswer;
  answers?: CheckAnswer[];
  closed?: number;
  closedAt?: number;
  supersededBy?: number;
  supersededAt?: number;
}

export const checkPassed = (c: CheckState): boolean => c.closed === undefined && c.supersededBy === undefined && c.answer?.pass === true;

export function replaceRefusal(checks: ReadonlyMap<number, CheckState>, m: { seq: number; from: string; check?: CheckAsk }): string | undefined {
  const id = m.check?.replaces;
  if (id === undefined) return undefined;
  const was = checks.get(id);
  if (!was || !(id < m.seq)) return `#${id} isn't a check to replace`;
  if (was.by !== m.from) return "a check replaces only a check its own asker made";
  if (was.closed !== undefined || was.supersededBy !== undefined) return `#${id} is already closed or replaced`;
  return undefined;
}

export function openCheck(checks: Map<number, CheckState>, m: { seq: number; from: string; choices?: string[]; holds?: number[]; check?: CheckAsk; ts: number; rts?: number }): void {
  if (!m.check || !m.choices?.length) return;
  const { replaces, ...check } = m.check;
  const was = replaces !== undefined ? checks.get(replaces) : undefined;
  const at = trustedAt(m);
  if (was) {
    was.supersededBy = m.seq;
    if (at !== undefined) was.supersededAt = at;
  }
  checks.set(m.seq, { seq: m.seq, by: m.from, ...check, choices: m.choices, holds: m.holds ?? [], ...(replaces !== undefined ? { replaces } : {}), ...(at !== undefined ? { askedAt: at } : {}) });
}

export function answerChecks(checks: Map<number, CheckState>, m: { seq: number; from: string; body: string; re?: number[]; ts: number; rts?: number }, owner: string | undefined): void {
  for (const id of m.re ?? []) {
    const c = checks.get(id);
    if (!c || c.closed !== undefined || c.supersededBy !== undefined) continue;
    if (m.from !== c.decider && m.from !== owner) continue;
    const choice = choiceIn(m.body, c.choices);
    if (!choice) continue;
    const at = trustedAt(m);
    c.answer = { choice, pass: choice === c.choices[0], by: m.from, seq: m.seq, ...(at !== undefined ? { at } : {}) };
    c.answers = [...(c.answers ?? []), c.answer];
  }
}

export function closeCheck(checks: Map<number, CheckState>, ask: number, m: { seq: number; ts: number; rts?: number }): void {
  const c = checks.get(ask);
  if (!c || c.closed !== undefined) return;
  c.closed = m.seq;
  const at = trustedAt(m);
  if (at !== undefined) c.closedAt = at;
}

const before = (at: number | undefined, x: number): boolean => at === undefined || at <= x;

export function passedAt(c: CheckState, x: number): boolean {
  if (c.closed !== undefined && before(c.closedAt, x)) return false;
  if (c.supersededBy !== undefined && before(c.supersededAt, x)) return false;
  const standing = inOrderOfHappening(c.answers ?? (c.answer ? [c.answer] : []), (a) => a.at).filter((a) => heldBefore(a.at, x));
  return standing.at(-1)?.pass === true;
}

export const askedBefore = (c: CheckState, x: number): boolean => c.askedAt === undefined || c.askedAt <= x;
export const replacedBefore = (c: CheckState, x: number): boolean => c.supersededBy !== undefined && before(c.supersededAt, x);
