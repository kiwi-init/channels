import { artifactKey, choiceIn, type CheckArtifact, type CheckAsk, type CheckPhase } from "../checks.ts";
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
  answer?: CheckAnswer;
  closed?: number;
  supersededBy?: number;
}

export const checkPassed = (c: CheckState): boolean => c.closed === undefined && c.supersededBy === undefined && c.answer?.pass === true;

const sameSubject = (a: CheckState, b: CheckState): boolean => a.phase === b.phase && artifactKey(a.artifact) === artifactKey(b.artifact) && a.holds.some((h) => b.holds.includes(h));

export function openCheck(checks: Map<number, CheckState>, m: { seq: number; from: string; choices?: string[]; holds?: number[]; check?: CheckAsk }): void {
  if (!m.check || !m.choices?.length) return;
  const added: CheckState = { seq: m.seq, by: m.from, ...m.check, choices: m.choices, holds: m.holds ?? [] };
  for (const c of checks.values()) if (c.supersededBy === undefined && c.closed === undefined && sameSubject(c, added)) c.supersededBy = m.seq;
  checks.set(m.seq, added);
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
