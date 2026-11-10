import * as Effect from "effect/Effect";
import { wellFormedRunId } from "@kiwi/core/checks.ts";
import { stepLines } from "@kiwi/core/format.ts";
import { isLanding } from "@kiwi/core/protocol.ts";
import { taskId, type ChannelState } from "@kiwi/core/state.ts";
import { parseSpan, STEP_WORDS_MAX, STEPS_MAX, stepsOfThen, wellFormedStepId, wellFormedStepSpec, type StepEdit, type StepSpec } from "@kiwi/core/steps.ts";
import { args, opt, optionsInOrder } from "../args.ts";
import { die, out, type session } from "../context.ts";

type Session = Effect.Success<ReturnType<typeof session>>;

const STEPS_USAGE =
  '--then takes merge, release:tag, release:npm:PKG@RANGE, run or none, or the words of a step: repeat it for a list, each with its own --by NAME, --wait "24h why", --run ID --expect 2h or --answered N (the number of a question)';

export type Landed = { kind: "default" } | { kind: "none" } | { kind: "steps"; steps: StepSpec[] } | { kind: "bad"; why: string };

type Group = { words: string; by?: string; wait?: string; run?: string; expect?: string; answered?: string };

const WAIT = /^(\d{1,4}[mhd])[\s:,]+(\S[\s\S]*)$/;

function specOf(g: Group): StepSpec[] | string {
  const plain = g.by === undefined && g.wait === undefined && g.run === undefined && g.expect === undefined && g.answered === undefined;
  if (g.words === "none") return "--then none stands alone: it means no steps, so approval finishes the task";
  if (plain && isLanding(g.words)) return stepsOfThen(g.words);
  if (g.words.length > STEP_WORDS_MAX) return `a step's words are at most ${STEP_WORDS_MAX} characters`;
  const waited = g.wait === undefined ? undefined : WAIT.exec(g.wait.trim());
  const ms = waited ? parseSpan(waited[1] ?? "") : null;
  if (g.wait !== undefined && (!waited || ms === null)) return '--wait takes how long and why: --wait "24h soak in hml" (m, h or d)';
  if (g.run !== undefined && g.expect === undefined) return "a step that waits on a run says how long it should take: --expect 2h";
  const expected = g.expect === undefined ? null : parseSpan(g.expect);
  if (g.expect !== undefined && expected === null) return "--expect takes how long the run should take: 30m, 2h or 1d";
  if (g.expect !== undefined && g.by === undefined) return "a step that waits on a run names who is behind it: --by NAME";
  if (g.run !== undefined && !wellFormedRunId(g.run)) return `"${g.run}" isn't a run id: letters, digits and . _ : / @ + -, at most 200`;
  const ask = g.answered === undefined ? undefined : /^#?[1-9]\d{0,14}$/.test(g.answered) ? Number(g.answered.replace(/^#/, "")) : null;
  if (ask === null) return "--answered takes a question's number: the step ends when it is answered with its first option";
  if (ask !== undefined && g.words === "merge") return "a merge step ends when its PR merges: put --answered on a step of its own";
  const spec: StepSpec = {
    words: g.words,
    ...(g.by !== undefined ? { by: g.by } : {}),
    ...(g.words === "merge" ? { detector: { kind: "pr-merged" as const } } : ask !== undefined ? { detector: { kind: "answered" as const, ask } } : {}),
    ...(waited && ms !== null ? { wait: { reason: (waited[2] ?? "").trim(), ms } } : {}),
    ...(expected !== null ? { run: { ...(g.run !== undefined ? { id: g.run } : {}), expected } } : {}),
  };
  return wellFormedStepSpec(spec) ? [spec] : `"${g.words}" isn't a step: one line of words, a member's name for --by`;
}

export function landingFromOptions(): Landed {
  void [opt.then, opt.by, opt.wait, opt.run, opt.expect, opt.answered];
  const groups: Group[] = [];
  for (const { name, value } of optionsInOrder) {
    const said = value.trim();
    if (name === "then") {
      if (!said) return { kind: "bad", why: STEPS_USAGE };
      groups.push({ words: said });
      continue;
    }
    if (name !== "by" && name !== "wait" && name !== "run" && name !== "expect" && name !== "answered") continue;
    const last = groups.at(-1);
    if (!last) return { kind: "bad", why: `--${name} goes after the --then it belongs to` };
    if (last[name] !== undefined) return { kind: "bad", why: `--${name} is given once per --then` };
    last[name] = said;
  }
  const [only] = groups;
  if (!only) return { kind: "default" };
  const bare = only.by === undefined && only.wait === undefined && only.run === undefined && only.expect === undefined && only.answered === undefined;
  if (groups.length === 1 && only.words === "none" && bare) return { kind: "none" };
  const steps: StepSpec[] = [];
  for (const g of groups) {
    const made = specOf(g);
    if (typeof made === "string") return { kind: "bad", why: made };
    steps.push(...made);
  }
  if (steps.length > STEPS_MAX) return { kind: "bad", why: `a task lands by at most ${STEPS_MAX} steps` };
  return { kind: "steps", steps };
}

const LANDED_USAGE = 'usage: kiwi task landed T7 [--step ID] [--link https://…] ["note"]';

export const taskLanded = (s: Session, id: number) =>
  Effect.gen(function* () {
    const links = opt.link ?? [];
    if (links.length > 1) return yield* die("--link names one link: where the step's result can be seen");
    const link = links[0]?.trim();
    if (link !== undefined && !/^https:\/\/\S+$/.test(link)) return yield* die(`"${link}" isn't an https link`);
    const step = opt["step-id"]?.trim();
    if (step !== undefined && !wellFormedStepId(step)) return yield* die(`"${step}" isn't a step id: kiwi task steps ${taskId(id)} lists them (s1, s2, …)\n${LANDED_USAGE}`);
    const note = args.slice(3).join(" ") || opt.note || undefined;
    const done = yield* s.taskLanded(id, { ...(step !== undefined ? { step } : {}), ...(link ? { link } : {}), ...(note ? { note } : {}) });
    const t = done.state.tasks.get(id);
    if (!t) return yield* die(`no task ${taskId(id)}`);
    const next = t.state === "done" ? `${taskId(id)} is done` : `${taskId(id)} is still ${t.state}`;
    return out([`ended step ${done.step} of ${taskId(id)}: ${next}`, ...stepLines(done.state, t, Date.now())].join("\n"));
  });

const STEPS_EDIT_USAGE = [
  "usage: kiwi task steps T7                                  its steps, with their ids",
  '       kiwi task steps T7 add "words" [--by NAME] [--wait "24h why"] [--run ID --expect 2h] [--answered N] [--before ID]',
  "       kiwi task steps T7 remove ID",
  "       kiwi task steps T7 move ID [--before ID]            to the end when --before is left out",
  "       kiwi task steps T7 by ID NAME|none                  who moves it (none: the task's lander)",
  '       kiwi task steps T7 skip ID "why"',
  '       kiwi task steps T7 wait ID 24h "why"',
  "       kiwi task steps T7 run ID RUN [--expect 2h]         the run it waits on",
  "a person or the lead changes steps; a step's own mover may set its wait or its run",
].join("\n");

function editFromArgs(): StepEdit | string {
  const verb = args[3];
  const before = opt.before?.trim();
  if (before !== undefined && !wellFormedStepId(before)) return `"${before}" isn't a step id`;
  if (verb === "add") {
    const words = args.slice(4).join(" ").trim();
    if (!words) return STEPS_EDIT_USAGE;
    const made = specOf({
      words,
      ...(opt.by?.[0] !== undefined ? { by: opt.by[0].trim() } : {}),
      ...(opt.wait !== undefined ? { wait: opt.wait } : {}),
      ...(opt.run?.[0] !== undefined ? { run: opt.run[0].trim() } : {}),
      ...(opt.expect !== undefined ? { expect: opt.expect } : {}),
      ...(opt.answered?.[0] !== undefined ? { answered: opt.answered[0].trim() } : {}),
    });
    if (typeof made === "string") return made;
    const [step] = made;
    if (!step || made.length !== 1) return `"${words}" stands for more than one step: add them one at a time`;
    return { kind: "add", step, ...(before !== undefined ? { before } : {}) };
  }
  const id = args[4]?.trim();
  if (!id || !wellFormedStepId(id)) return STEPS_EDIT_USAGE;
  const rest = args.slice(5).join(" ").trim();
  if (verb === "remove") return { kind: "remove", id };
  if (verb === "move") return { kind: "move", id, ...(before !== undefined ? { before } : {}) };
  if (verb === "by") return rest ? { kind: "by", id, by: rest === "none" ? null : rest } : STEPS_EDIT_USAGE;
  if (verb === "skip") return rest ? { kind: "skip", id, why: rest } : 'a skipped step says why: kiwi task steps T7 skip ID "why"';
  if (verb === "wait") {
    const ms = parseSpan(args[5] ?? "");
    const reason = args.slice(6).join(" ").trim();
    return ms !== null && reason ? { kind: "wait", id, reason, ms } : 'a wait says how long and why: kiwi task steps T7 wait ID 24h "why"';
  }
  if (verb === "run") {
    const run = args[5]?.trim();
    const expected = opt.expect === undefined ? undefined : parseSpan(opt.expect);
    if (!run || !wellFormedRunId(run)) return STEPS_EDIT_USAGE;
    if (expected === null) return "--expect takes how long the run should take: 30m, 2h or 1d";
    return { kind: "run", id, run, ...(expected !== undefined ? { expected } : {}) };
  }
  return STEPS_EDIT_USAGE;
}

const shown = (state: ChannelState, id: number): string => {
  const t = state.tasks.get(id);
  const lines = t ? stepLines(state, t, Date.now()) : [];
  return lines.length ? [`${taskId(id)} ${t?.state === "landing" ? "is landing" : `is ${t?.state ?? "gone"}`}`, ...lines].join("\n") : `${taskId(id)} has no landing steps: it finishes on approval`;
};

export const taskSteps = (s: Session, id: number) =>
  Effect.gen(function* () {
    if (args[3] === undefined) {
      const { state } = yield* s.state();
      if (!state.tasks.has(id)) return yield* die(`no task ${taskId(id)}`);
      return out(shown(state, id));
    }
    const edit = editFromArgs();
    if (typeof edit === "string") return yield* die(edit);
    return out(shown(yield* s.taskSteps(id, edit), id));
  });
