import { choiceIn, type CheckAsk, type CheckPhase } from "../checks.ts";

interface CheckAnswer {
  choice: string;
  pass: boolean;
  by: string;
  seq: number;
}

export interface CheckState {
  seq: number;
  by: string;
  phase: CheckPhase;
  decider: string;
  choices: string[];
  holds: number[];
  replaces?: number;
  answer?: CheckAnswer;
  answers?: CheckAnswer[];
  closed?: number;
  supersededBy?: number;
}

const answerOf = (a: CheckAnswer): CheckAnswer => ({ choice: a.choice, pass: a.pass, by: a.by, seq: a.seq });

export const checkFrom = (c: CheckState): CheckState => ({
  seq: c.seq,
  by: c.by,
  phase: c.phase,
  decider: c.decider,
  choices: c.choices,
  holds: c.holds,
  ...(c.replaces !== undefined ? { replaces: c.replaces } : {}),
  ...(c.answer ? { answer: answerOf(c.answer) } : {}),
  ...(c.answers ? { answers: c.answers.map(answerOf) } : {}),
  ...(c.closed !== undefined ? { closed: c.closed } : {}),
  ...(c.supersededBy !== undefined ? { supersededBy: c.supersededBy } : {}),
});

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

export function openCheck(checks: Map<number, CheckState>, m: { seq: number; from: string; choices?: string[]; holds?: number[]; check?: CheckAsk }): number | undefined {
  if (!m.check || !m.choices?.length) return undefined;
  const { replaces, phase, decider } = m.check;
  const was = replaces !== undefined ? checks.get(replaces) : undefined;
  if (was) was.supersededBy = m.seq;
  checks.set(m.seq, { seq: m.seq, by: m.from, phase, decider, choices: m.choices, holds: m.holds ?? [], ...(replaces !== undefined ? { replaces } : {}) });
  return was?.seq;
}

export function answerChecks(checks: Map<number, CheckState>, m: { seq: number; from: string; body: string; re?: number[] }, owner: string | undefined): void {
  for (const id of m.re ?? []) {
    const c = checks.get(id);
    if (!c || c.closed !== undefined || c.supersededBy !== undefined) continue;
    if (m.from !== c.decider && m.from !== owner) continue;
    const choice = choiceIn(m.body, c.choices);
    if (!choice) continue;
    c.answer = { choice, pass: choice === c.choices[0], by: m.from, seq: m.seq };
    c.answers = [...(c.answers ?? []), c.answer];
  }
}

export function closeCheck(checks: Map<number, CheckState>, ask: number, seq: number): void {
  const c = checks.get(ask);
  if (c && c.closed === undefined) c.closed = seq;
}
