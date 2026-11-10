import type { CheckArtifact } from "../checks.ts";
import { arm, currentStep, mintSteps, STEPS_MAX, stepById, stepsOfThen, stepText, type LandingStep, type RunSight, type StepEdit, type StepSpec } from "../steps.ts";
import type { CheckState } from "./checks.ts";
import { isReviewCheck } from "../protocol.ts";
import { approvedAt, judgedHead } from "../stage.ts";
import { runStart, runsUnknownSince, shaKey, succeededBy, type GithubPr, type GithubState } from "./github.ts";
import type { Task } from "./types.ts";

export type StepMark = { seq: number; by: string; at: number };

export interface StepView {
  github: GithubState;
  prOf: (task: Task) => GithubPr | undefined;
}

const id = (t: Task): string => `T${t.id}`;

export const artifactWords = (a: CheckArtifact): string => (a.kind === "pr" ? `${a.repo}#${a.pr} at ${a.sha.slice(0, 7)}` : a.kind === "run" ? `run ${a.id}` : `${a.pkg}@${a.version}`);

export function seedSteps(task: Task, specs: readonly StepSpec[], from?: "then"): void {
  const made = mintSteps(task, specs).map((s): LandingStep => (from ? { ...s, from } : s));
  if (made.length) task.steps = [...(task.steps ?? []), ...made];
}

export function reseedThen(task: Task, then: string | undefined): void {
  const steps = task.steps ?? [];
  const kept = steps.filter((s) => s.from !== "then" || s.progress.kind === "ended");
  const at = steps.findIndex((s) => s.from === "then" && s.progress.kind === "open");
  const before = at === -1 ? kept.length : steps.slice(0, at).filter((s) => kept.includes(s)).length;
  const made = mintSteps(task, then ? stepsOfThen(then) : []).map((s): LandingStep => ({ ...s, from: "then" }));
  const next = [...kept.slice(0, before), ...made, ...kept.slice(before)];
  task.steps = next.length ? next : undefined;
}

export const hasOpenSteps = (task: Task): boolean => currentStep(task) !== undefined;

export function advance(task: Task, mark: StepMark): void {
  while (task.state === "landing") {
    const step = currentStep(task);
    if (!step) {
      task.state = "done";
      task.closedSeq = mark.seq;
      task.updatedAt = mark.at;
      return;
    }
    arm(step, mark.at);
    const seen = step.progress.kind === "open" ? step.progress.seen : undefined;
    if (!seen) return;
    step.progress = { kind: "ended", end: { how: "detected", by: seen.by, seq: mark.seq, ts: mark.at, saw: seen.saw } };
    task.updatedAt = mark.at;
    task.notes.push({ seq: mark.seq, by: seen.by, ts: mark.at, text: `step ${stepText(step)} ended: ${seen.saw}` });
  }
}

export function see(task: Task, step: LandingStep, mark: StepMark, saw: string): void {
  if (step.progress.kind !== "open" || step.progress.seen) return;
  step.progress = { kind: "open", seen: { seq: mark.seq, by: mark.by, saw } };
  advance(task, mark);
}

export function seeThenSteps(task: Task, mark: StepMark, saw: string): void {
  for (const s of task.steps ?? []) if (s.from === "then" && s.progress.kind === "open" && !s.progress.seen) s.progress = { kind: "open", seen: { seq: mark.seq, by: mark.by, saw } };
}

export function say(task: Task, step: LandingStep, mark: StepMark, said: { link?: string; note?: string }): void {
  step.progress = { kind: "ended", end: { how: "said", by: mark.by, seq: mark.seq, ts: mark.at, ...(said.link ? { link: said.link } : {}), ...(said.note ? { note: said.note } : {}) } };
  task.updatedAt = mark.at;
  task.notes.push({ seq: mark.seq, by: mark.by, ts: mark.at, text: `step ${stepText(step)} done${said.note ? `: ${said.note}` : ""}${said.link ? ` (${said.link})` : ""}` });
  advance(task, mark);
}

export function runSight(github: GithubState, task: Task, step: LandingStep): RunSight {
  const run = step.run?.id;
  if (run === undefined || runsUnknownSince(github, task)) return "blind";
  const seen = runStart(github, run, task.createdRts ?? Number.NEGATIVE_INFINITY);
  if (!seen) return "unseen";
  return seen.conclusion === undefined ? "running" : seen.conclusion === "success" ? "succeeded" : "failed";
}

export function observedRefusal(view: StepView, task: Task, step: LandingStep, artifact: CheckArtifact): string | null {
  if (artifact.kind === "pr") {
    if (step.detector?.kind !== "pr-merged") return `step ${stepText(step)} of ${id(task)} doesn't end on a merged PR`;
    const pr = view.prOf(task);
    if (!pr || pr.repo.toLowerCase() !== artifact.repo.toLowerCase() || pr.number !== artifact.pr) return `${artifactWords(artifact)} isn't ${id(task)}'s PR`;
    return pr.state === "merged" ? null : `${id(task)}'s PR #${pr.number} hasn't merged`;
  }
  if (artifact.kind === "run") {
    if (step.run?.id !== artifact.id) return `step ${stepText(step)} of ${id(task)} doesn't wait on run ${artifact.id}`;
    return runSight(view.github, task, step) === "succeeded" ? null : `run ${artifact.id} hasn't succeeded where Kiwi can see it`;
  }
  return `step ${stepText(step)} of ${id(task)} doesn't end on ${artifactWords(artifact)}`;
}

function missingAtMerge(github: GithubState, task: Task, pr: GithubPr & { sha: string }, merged: number): string | null {
  const round = task.rounds.filter((r) => r.rts === undefined || r.rts <= merged).at(-1);
  const result = round?.result;
  if (!round || result?.kind !== "approved" || result.rts === undefined || result.rts > merged) return "an approval before the merge";
  const held = { at: round.at, kept: round.kept?.filter((k) => k.rts !== undefined && k.rts <= merged) };
  if (!approvedAt(held, pr.sha)) return `an approval at ${pr.sha.slice(0, 7)}`;
  const runs = [...(github.checks.get(shaKey(pr.repo, judgedHead(held, pr.sha)))?.values() ?? [])].filter((c) => !isReviewCheck(c.name));
  const late = (result.runs ?? []).find((run) => !runs.some((c) => succeededBy(c, run, merged)));
  return late === undefined ? null : `CI run ${late} green before the merge`;
}

export function landedRefusal(view: StepView, task: Task, artifact: CheckArtifact): string | null {
  if (task.state !== "landing") return `${id(task)} isn't approved and landing: it's ${task.state}`;
  if (artifact.kind === "run") return task.run?.id === artifact.id ? null : `${artifactWords(artifact)} isn't ${id(task)}'s run`;
  const pr = view.prOf(task);
  if (pr?.state !== "merged" || !pr.sha) return `${id(task)} hasn't landed: its PR hasn't merged`;
  const missing = pr.mergedAt === undefined ? `GitHub's time for the merge of PR #${pr.number}` : missingAtMerge(view.github, task, { ...pr, sha: pr.sha }, pr.mergedAt);
  if (missing) return `${id(task)}'s PR #${pr.number} merged without ${missing}: a person closes it with a reason`;
  if (artifact.kind === "npm") return task.steps?.some((s) => s.from === "then" && s.words.startsWith(`publish ${artifact.pkg}@`)) ? null : `${id(task)} doesn't publish ${artifact.pkg}`;
  const own = pr.repo.toLowerCase() === artifact.repo.toLowerCase() && pr.number === artifact.pr && pr.sha === artifact.sha;
  return own ? null : `${id(task)} lands at ${pr.repo}#${pr.number} at ${pr.sha.slice(0, 7)}, not ${artifactWords(artifact)}`;
}

export interface StepObservation {
  task: Task;
  step: LandingStep;
  artifact: CheckArtifact;
  key: string;
}

export function stepObservations(view: StepView & { tasks: ReadonlyMap<number, Task> }): StepObservation[] {
  const out: StepObservation[] = [];
  for (const t of view.tasks.values()) {
    if (t.state === "done" || t.archived) continue;
    for (const s of t.steps ?? []) {
      if (s.progress.kind !== "open" || s.progress.seen) continue;
      const pr = s.detector?.kind === "pr-merged" ? view.prOf(t) : undefined;
      const artifact: CheckArtifact | undefined =
        pr?.state === "merged" && pr.sha
          ? { kind: "pr", repo: pr.repo, pr: pr.number, sha: pr.sha }
          : s.run?.id !== undefined && runSight(view.github, t, s) === "succeeded"
            ? { kind: "run", id: s.run.id }
            : undefined;
      if (artifact) out.push({ task: t, step: s, artifact, key: `T${t.id}:${s.id}:${artifactWords(artifact)}` });
    }
  }
  return out;
}

const asks = (step: LandingStep, ask: number): boolean => step.detector?.kind === "answered" && step.detector.ask === ask;

export function migrateChecks(tasks: ReadonlyMap<number, Task>, checks: ReadonlyMap<number, CheckState>): void {
  for (const check of checks.values()) {
    if (check.phase !== "pre-ship" || check.closed !== undefined || check.supersededBy !== undefined) continue;
    for (const held of check.holds) {
      const task = tasks.get(held);
      if (!task || task.steps?.some((s) => asks(s, check.seq))) continue;
      checkStep(task, { ...check, replaces: undefined });
    }
    const passed = (check.answers ?? (check.answer ? [check.answer] : [])).find((a) => a.pass);
    if (passed) checkAnswered(tasks, { ...check, answer: passed }, { seq: passed.seq, by: passed.by, at: "at" in passed && typeof passed.at === "number" ? passed.at : 0 });
  }
}

export const questionWatched = (tasks: ReadonlyMap<number, Task>, ask: number): boolean =>
  [...tasks.values()].some((t) => t.state !== "done" && !!t.steps?.some((s) => s.progress.kind === "open" && asks(s, ask)));

export function questionAnswered(tasks: ReadonlyMap<number, Task>, ask: number, choice: string, mark: StepMark): void {
  for (const task of tasks.values()) {
    if (task.state === "done") continue;
    for (const step of task.steps ?? []) if (asks(step, ask)) see(task, step, mark, `#${ask} answered “${choice}”`);
  }
}

export function seeAnswered(task: Task, passed: ReadonlyMap<number, string>, mark: StepMark): void {
  for (const step of task.steps ?? []) {
    const choice = step.detector?.kind === "answered" ? passed.get(step.detector.ask) : undefined;
    if (choice !== undefined) see(task, step, mark, `#${step.detector?.kind === "answered" ? step.detector.ask : 0} answered “${choice}”`);
  }
}

export function checkStep(task: Task, check: CheckState): void {
  if (task.state === "done" || check.phase !== "pre-ship") return;
  const replaced = check.replaces;
  const was = replaced === undefined ? undefined : task.steps?.find((s) => asks(s, replaced) && s.progress.kind === "open");
  if (was) {
    was.detector = { kind: "answered", ask: check.seq };
    was.words = `check #${check.seq}`;
    was.by = check.decider;
    was.progress = { kind: "open" };
    return;
  }
  const [made] = mintSteps(task, [{ words: `check #${check.seq}`, by: check.decider, detector: { kind: "answered", ask: check.seq } }]);
  if (!made) return;
  const steps = task.steps ?? [];
  const first = steps.findIndex((s) => s.progress.kind === "open");
  const place = first === -1 ? steps.length : first;
  task.steps = [...steps.slice(0, place), { ...made, from: "check" }, ...steps.slice(place)];
}

export function checkAnswered(tasks: ReadonlyMap<number, Task>, check: CheckState, mark: StepMark): void {
  if (check.answer?.pass !== true) return;
  for (const held of check.holds) {
    const task = tasks.get(held);
    const step = task?.steps?.find((s) => asks(s, check.seq));
    if (task && step) see(task, step, mark, `#${check.seq} answered “${check.answer.choice}”`);
  }
}

export function checkClosed(tasks: ReadonlyMap<number, Task>, check: CheckState, mark: StepMark): void {
  for (const held of check.holds) {
    const task = tasks.get(held);
    if (!task?.steps) continue;
    const kept = task.steps.filter((s) => !(asks(s, check.seq) && s.progress.kind === "open"));
    if (kept.length === task.steps.length) continue;
    task.steps = kept.length ? kept : undefined;
    advance(task, mark);
  }
}

export function stepEditRefusal(task: Task, edit: StepEdit, from: { name: string; person: boolean; lead: boolean }): string | null {
  const trusted = from.person || from.lead;
  if (task.state === "done") return `${id(task)} is already done`;
  if (edit.kind === "add") {
    if (!trusted) return `only a person or the lead changes ${id(task)}'s steps`;
    if ((task.steps?.length ?? 0) >= STEPS_MAX) return `${id(task)} already has ${STEPS_MAX} steps`;
    if (edit.before !== undefined && stepById(task, edit.before)?.progress.kind !== "open") return `${id(task)} has no open step ${edit.before} to go before`;
    return null;
  }
  const step = stepById(task, edit.id);
  if (!step) return `${id(task)} has no step ${edit.id}`;
  if (step.progress.kind === "ended") return `step ${stepText(step)} of ${id(task)} has already ended`;
  const mover = step.by ?? task.lander ?? task.owner;
  const own = (edit.kind === "wait" || edit.kind === "run") && from.name === mover;
  if (!trusted && !own) return `only a person or the lead changes ${id(task)}'s steps${edit.kind === "wait" || edit.kind === "run" ? `, or ${mover ?? "its mover"} for this one` : ""}`;
  if (edit.kind === "move" && edit.before !== undefined && stepById(task, edit.before)?.progress.kind !== "open") return `${id(task)} has no open step ${edit.before} to go before`;
  if (edit.kind === "run" && !step.by) return `step ${stepText(step)} of ${id(task)} names nobody behind its run: name who first`;
  if (edit.kind === "run" && edit.expected === undefined && !step.run) return `step ${stepText(step)} of ${id(task)} needs how long its run is expected to take`;
  return null;
}

function placed(steps: readonly LandingStep[], step: LandingStep, before: string | undefined): LandingStep[] {
  const rest = steps.filter((s) => s !== step);
  const at = before === undefined ? -1 : rest.findIndex((s) => s.id === before);
  return at === -1 ? [...rest, step] : [...rest.slice(0, at), step, ...rest.slice(at)];
}

export function editSteps(task: Task, edit: StepEdit, mark: StepMark): void {
  const steps = task.steps ?? [];
  const note = (text: string) => task.notes.push({ seq: mark.seq, by: mark.by, ts: mark.at, text });
  const current = (step: LandingStep): boolean => task.state === "landing" && currentStep(task) === step;
  if (edit.kind === "add") {
    const [made] = mintSteps(task, [edit.step]);
    if (!made) return;
    task.steps = placed(steps, made, edit.before);
    note(`added step ${stepText(made)}`);
  } else {
    const step = stepById(task, edit.id);
    if (!step) return;
    switch (edit.kind) {
      case "remove": {
        const kept = steps.filter((s) => s !== step);
        task.steps = kept.length ? kept : undefined;
        note(`removed step ${stepText(step)}`);
        break;
      }
      case "move":
        task.steps = placed(steps, step, edit.before);
        note(`moved step ${stepText(step)} ${edit.before ? `before ${edit.before}` : "to the end"}`);
        break;
      case "by":
        step.by = edit.by ?? undefined;
        note(`step ${stepText(step)} is ${edit.by ?? "its lander"}'s now`);
        break;
      case "skip":
        step.progress = { kind: "ended", end: { how: "skipped", by: mark.by, seq: mark.seq, ts: mark.at, why: edit.why } };
        note(`skipped step ${stepText(step)}: ${edit.why}`);
        break;
      case "wait":
        step.wait = { reason: edit.reason, ms: edit.ms, ...(current(step) ? { until: mark.at + edit.ms } : {}) };
        note(`step ${stepText(step)} waits: ${edit.reason}`);
        break;
      case "run": {
        const expected = edit.expected ?? step.run?.expected;
        if (expected === undefined) return;
        if (step.run?.id !== edit.run) step.progress = { kind: "open" };
        step.run = { id: edit.run, expected, ...(current(step) ? { due: mark.at + expected } : {}) };
        note(`step ${stepText(step)} waits on run ${edit.run}`);
        break;
      }
      default: {
        const never: never = edit;
        return never;
      }
    }
  }
  task.updatedAt = mark.at;
  advance(task, mark);
}
