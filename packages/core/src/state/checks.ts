import { choiceIn, type CheckArtifact, type CheckAsk, type CheckPhase } from "../checks.ts";
import { trustedAt } from "./times.ts";

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
  answer?: CheckAnswer;
  closed?: number;
  supersededBy?: number;
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

export function openCheck(checks: Map<number, CheckState>, m: { seq: number; from: string; choices?: string[]; holds?: number[]; check?: CheckAsk }): void {
  if (!m.check || !m.choices?.length) return;
  const { replaces, ...check } = m.check;
  const was = replaces !== undefined ? checks.get(replaces) : undefined;
  if (was) was.supersededBy = m.seq;
  checks.set(m.seq, { seq: m.seq, by: m.from, ...check, choices: m.choices, holds: m.holds ?? [], ...(replaces !== undefined ? { replaces } : {}) });
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
  }
}

export function closeCheck(checks: Map<number, CheckState>, ask: number, seq: number): void {
  const c = checks.get(ask);
  if (c && c.closed === undefined) c.closed = seq;
}
