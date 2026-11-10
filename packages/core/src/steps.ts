import { wellFormedArtifact, wellFormedRunId, type CheckArtifact } from "./checks.ts";

type StepDetector = { kind: "pr-merged" } | { kind: "answered"; ask: number };

export interface StepSpec {
  words: string;
  by?: string;
  detector?: StepDetector;
  wait?: { reason: string; ms: number };
  run?: { id?: string; expected: number };
}

type StepEnd =
  | { how: "said"; by: string; seq: number; ts: number; link?: string; note?: string }
  | { how: "detected"; by: string; seq: number; ts: number; saw: string }
  | { how: "skipped"; by: string; seq: number; ts: number; why: string }
  | { how: "landed"; by: string; seq: number; ts: number };

type StepSeen = { seq: number; by: string; saw: string; merged?: number };

type StepProgress = { kind: "open"; seen?: StepSeen } | { kind: "ended"; end: StepEnd };

export interface LandingStep {
  id: string;
  words: string;
  by?: string;
  detector?: StepDetector;
  wait?: { reason: string; ms: number; until?: number };
  run?: { id?: string; expected: number; due?: number };
  from?: "then" | "check";
  progress: StepProgress;
}

export type StepEdit =
  | { kind: "add"; step: StepSpec; before?: string }
  | { kind: "remove"; id: string }
  | { kind: "move"; id: string; before?: string }
  | { kind: "by"; id: string; by: string | null }
  | { kind: "skip"; id: string; why: string }
  | { kind: "wait"; id: string; reason: string; ms: number }
  | { kind: "run"; id: string; run: string; expected?: number };

export const STEPS_MAX = 20;
export const STEP_WORDS_MAX = 200;
const STEP_ID = /^s[1-9]\d{0,5}$/;
const NAME_MAX = 64;
const REASON_MAX = 300;
const WAIT_MAX_MS = 366 * 24 * 60 * 60 * 1000;

const record = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const text = (x: unknown, max: number): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max && !/[\r\n]/.test(x);
const span = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0 && (x as number) <= WAIT_MAX_MS;
const only = (r: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(r).every((k) => keys.includes(k));

export const wellFormedStepId = (x: unknown): x is string => typeof x === "string" && STEP_ID.test(x);

function wellFormedDetector(x: unknown): x is StepDetector {
  const d = record(x);
  if (!d) return false;
  if (d.kind === "pr-merged") return only(d, ["kind"]);
  return d.kind === "answered" && only(d, ["kind", "ask"]) && Number.isSafeInteger(d.ask) && (d.ask as number) > 0;
}

export function wellFormedStepSpec(x: unknown): x is StepSpec {
  const s = record(x);
  if (!s || !only(s, ["words", "by", "detector", "wait", "run"]) || !text(s.words, STEP_WORDS_MAX)) return false;
  if (s.by !== undefined && !text(s.by, NAME_MAX)) return false;
  if (s.detector !== undefined && !wellFormedDetector(s.detector)) return false;
  const wait = s.wait === undefined ? undefined : record(s.wait);
  if (s.wait !== undefined && !(wait && only(wait, ["reason", "ms"]) && text(wait.reason, REASON_MAX) && span(wait.ms))) return false;
  const run = s.run === undefined ? undefined : record(s.run);
  if (s.run !== undefined && !(run && only(run, ["id", "expected"]) && span(run.expected) && (run.id === undefined || wellFormedRunId(run.id)))) return false;
  return !(s.run !== undefined && s.by === undefined);
}

export const wellFormedStepSpecs = (x: unknown): x is StepSpec[] => Array.isArray(x) && x.length > 0 && x.length <= STEPS_MAX && x.every(wellFormedStepSpec);

export function wellFormedStepEdit(x: unknown): x is StepEdit {
  const e = record(x);
  if (!e) return false;
  const before = e.before === undefined || wellFormedStepId(e.before);
  switch (e.kind) {
    case "add":
      return only(e, ["kind", "step", "before"]) && wellFormedStepSpec(e.step) && before;
    case "remove":
      return only(e, ["kind", "id"]) && wellFormedStepId(e.id);
    case "move":
      return only(e, ["kind", "id", "before"]) && wellFormedStepId(e.id) && before && e.before !== e.id;
    case "by":
      return only(e, ["kind", "id", "by"]) && wellFormedStepId(e.id) && (e.by === null || text(e.by, NAME_MAX));
    case "skip":
      return only(e, ["kind", "id", "why"]) && wellFormedStepId(e.id) && text(e.why, REASON_MAX);
    case "wait":
      return only(e, ["kind", "id", "reason", "ms"]) && wellFormedStepId(e.id) && text(e.reason, REASON_MAX) && span(e.ms);
    case "run":
      return only(e, ["kind", "id", "run", "expected"]) && wellFormedStepId(e.id) && wellFormedRunId(e.run) && (e.expected === undefined || span(e.expected));
    default:
      return false;
  }
}

export type StepLanded = { step: string; artifact?: CheckArtifact; link?: string; note?: string };

export function wellFormedStepLanded(e: Record<string, unknown>): boolean {
  if (!wellFormedStepId(e.step)) return false;
  if (e.artifact !== undefined) return e.link === undefined && e.note === undefined && wellFormedArtifact(e.artifact);
  const link = e.link === undefined || (typeof e.link === "string" && e.link.length <= 500 && /^https:\/\/[^\s]+$/.test(e.link));
  return link && (e.note === undefined || text(e.note, 500));
}

const MERGE: StepSpec = { words: "merge", detector: { kind: "pr-merged" } };

export function stepsOfThen(then: string): StepSpec[] {
  if (then === "merge") return [MERGE];
  if (then === "release:tag") return [MERGE, { words: "release" }];
  if (then.startsWith("release:npm:")) return [MERGE, { words: `publish ${then.slice("release:npm:".length)}` }];
  if (then === "run") return [{ words: "run" }];
  return [];
}

export interface StepHolder {
  steps?: LandingStep[];
  stepCount?: number;
}

export function thenChanged(t: StepHolder, then: string): boolean {
  const have = (t.steps ?? []).filter((s) => s.from === "then").map((s) => s.words);
  const want = stepsOfThen(then).map((s) => s.words);
  return have.length !== want.length || have.some((words, i) => words !== want[i]);
}

export const currentStep = (t: StepHolder): LandingStep | undefined => t.steps?.find((s) => s.progress.kind === "open");

export const stepById = (t: StepHolder, id: string): LandingStep | undefined => t.steps?.find((s) => s.id === id);

export function mintSteps(t: StepHolder, specs: readonly StepSpec[]): LandingStep[] {
  return specs.map((spec) => {
    t.stepCount = (t.stepCount ?? 0) + 1;
    return { id: `s${t.stepCount}`, ...spec, progress: { kind: "open" } };
  });
}

export function arm(step: LandingStep, at: number): void {
  if (step.wait && step.wait.until === undefined) step.wait.until = at + step.wait.ms;
  if (step.run && step.run.due === undefined) step.run.due = at + step.run.expected;
}

export type RunSight = "blind" | "unseen" | "running" | "failed" | "succeeded";

export type StepMove =
  | { kind: "member"; name: string; why?: "run failed" | "run can't be seen" | "run overran" }
  | { kind: "run"; behind: string; due: number }
  | { kind: "waiting"; until: number; reason: string }
  | { kind: "nobody" };

export function stepMove(step: LandingStep, lander: string | undefined, now: number, run: RunSight = "blind"): StepMove {
  if (step.wait?.until !== undefined && now < step.wait.until) return { kind: "waiting", until: step.wait.until, reason: step.wait.reason };
  if (step.run && step.by) {
    if (run === "failed") return { kind: "member", name: step.by, why: "run failed" };
    if (run === "blind" || step.run.id === undefined) return { kind: "member", name: step.by, why: "run can't be seen" };
    if (step.run.due !== undefined && now >= step.run.due) return { kind: "member", name: step.by, why: "run overran" };
    if (step.run.due !== undefined) return { kind: "run", behind: step.by, due: step.run.due };
  }
  const name = step.by ?? lander;
  return name ? { kind: "member", name } : { kind: "nobody" };
}

export const stepText = (step: Pick<LandingStep, "id" | "words">): string => (step.words ? `${step.id} “${step.words}”` : step.id);

export function landedStepRefusal(t: StepHolder & { id: number }, id: string): string | null {
  const step = stepById(t, id);
  const current = currentStep(t);
  const now = current ? `its current step is ${stepText(current)}` : "it has no step left";
  if (!step) return `T${t.id} has no step ${id}: ${now}`;
  if (step === current || step.progress.kind === "ended") return null;
  return `step ${stepText(step)} of T${t.id} isn't the current one: ${now}. A retry resends the step id it first carried; to end another step, name that one with --step`;
}

const DURATION = /^(\d{1,4})(m|h|d)$/;
const UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export function parseSpan(said: string): number | null {
  const hit = DURATION.exec(said.trim());
  if (!hit) return null;
  const unit = hit[2] === "m" ? UNIT.m : hit[2] === "h" ? UNIT.h : UNIT.d;
  const ms = Number(hit[1]) * unit;
  return span(ms) ? ms : null;
}

export function spanText(ms: number): string {
  if (ms % UNIT.d === 0) return `${ms / UNIT.d}d`;
  if (ms % UNIT.h === 0) return `${ms / UNIT.h}h`;
  if (ms >= 2 * UNIT.d) return `${Math.round(ms / UNIT.d)}d`;
  if (ms >= 2 * UNIT.h) return `${Math.round(ms / UNIT.h)}h`;
  return `${Math.max(1, Math.round(ms / UNIT.m))}m`;
}
