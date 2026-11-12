import * as Effect from "effect/Effect";
import {
  CHECKPOINT_MAX_LENGTH,
  MAX_GOAL_NAME,
  MAX_SPEC,
  MAX_SPEC_NOTE,
  PROOF_LABEL_MAX_LENGTH,
  PROOF_URL_MAX_LENGTH,
  REVIEW_SUMMARY_MAX_LENGTH,
  TASK_STATES,
  TASK_BODY_MAX_LENGTH,
  TASK_TITLE_LIMIT,
  ignored,
  type Event,
  type IssueRef,
  type KeptEvidence,
  type TaskState,
  type Verdict,
} from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { wellFormedRunId } from "@kiwi/core/checks.ts";
import { currentStep, landedStepRefusal, stepById, stepText, type StepEdit, type StepSpec } from "@kiwi/core/steps.ts";
import { stepEditRefusal } from "@kiwi/core/state/landing-steps.ts";
import {
  isPerson,
  openRound,
  reviewWaysOut,
  landingRefusal,
  reviewClaimRefusal,
  reviewMoveRefusal,
  revisedOut,
  specLease,
  specStage,
  specTasks,
  taskId,
  tickDoneWhen,
  type ChannelState,
  type Lease,
  type ReviewRound,
  type Spec,
  type Task,
} from "@kiwi/core/state.ts";
import { inlineText } from "@kiwi/core/membership.ts";
import { parseIssueRef, taskDigest, taskOfIssue } from "@kiwi/core/work.ts";
import { handBackText, heldBy, reviewedBy } from "@kiwi/core/handback.ts";
import { branchAreas } from "../areas.ts";
import { SessionMessaging } from "./messaging.ts";
import { oneLook } from "./shared.ts";

const CLAIM_TTL = 120_000;

function titleRefusal(title: string): string | null {
  if (title.length <= TASK_TITLE_LIMIT) return null;
  return `the title is ${title.length} characters, and a task's title is at most ${TASK_TITLE_LIMIT} so people can read the board: keep the outcome in the title and move the rest into the body (--body "…" or --file spec.md)`;
}

function shortTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  if (flat.length <= TASK_TITLE_LIMIT) return flat;
  const cut = flat.slice(0, TASK_TITLE_LIMIT - 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > TASK_TITLE_LIMIT / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

function judgedRound(t: Task, open: ReviewRound | undefined, round: number | undefined, at: string | undefined): Effect.Effect<ReviewRound, Rejected> {
  const id = taskId(t.id);
  const wanted = at?.trim() || undefined;
  if (!open) return Effect.fail(new Rejected(`${id} has no review round open`));
  if (round === undefined && wanted === undefined) return Effect.fail(new Rejected(`say which round of ${id} you reviewed: --round ${open.n}${open.at ? ` (or --at ${open.at})` : ""}`));
  const target = round !== undefined ? t.rounds.find((r) => r.n === round) : [...t.rounds].reverse().find((r) => r.at === wanted);
  if (!target) return Effect.fail(new Rejected(`${id} has no round ${round ?? `at ${wanted}`}`));
  if (target.n !== open.n) return Effect.fail(new Rejected(`round ${target.n} of ${id} isn't the open one: round ${open.n} is${open.at ? `, at ${open.at}` : ""}`));
  if (wanted !== undefined && target.at !== wanted) return Effect.fail(new Rejected(`round ${target.n} of ${id} is ${target.at ? `at ${target.at}` : "at no commit"}, not at ${wanted}`));
  return Effect.succeed(target);
}

export class SessionTasks extends SessionMessaging {
  areasHere: (task: number, prefix: string | null) => string[] | null = branchAreas;

  readonly taskAdd = Effect.fn("AgentSession.taskAdd")(
    { self: this },
    function* (
      this: SessionTasks,
      title: string,
      opts: { detail?: string; owner?: string; review?: string; re?: number; issue?: IssueRef; from?: number; steps?: StepSpec[]; noSteps?: true; lander?: string } = {},
    ) {
      const long = titleRefusal(title);
      if (long) return yield* new Rejected(long);
      if (opts.detail && opts.detail.length > TASK_BODY_MAX_LENGTH)
        return yield* new Rejected(`the body is ${opts.detail.length} characters, the most a task's body takes is ${TASK_BODY_MAX_LENGTH}: link the rest (a doc, an issue) instead`);
      const { state } = yield* this.state();
      if (opts.re !== undefined && (!state.placeOf.has(opts.re) || ignored(state.trust.get(opts.re)))) return yield* new Rejected(`no message #${opts.re}`);
      if (opts.from !== undefined && !state.tasks.has(opts.from)) return yield* new Rejected(`no task ${taskId(opts.from)} to come from`);
      const owner = opts.owner && (yield* this.resolveTo([opts.owner], state))?.[0];
      const review = opts.review === undefined ? undefined : yield* this.reviewer(state, opts.review);
      const lander = opts.lander && (yield* this.resolveTo([opts.lander], state))?.[0];
      const steps = opts.steps ? yield* this.stepSpecs(state, opts.steps) : undefined;
      return yield* this.event(
        {
          op: "task.add",
          title,
          ...(opts.detail ? { detail: opts.detail } : {}),
          ...(owner ? { owner } : {}),
          ...(review ? { review } : {}),
          ...(opts.issue ? { issue: opts.issue } : {}),
          ...(opts.from !== undefined ? { from: opts.from } : {}),
          ...(steps ? { steps } : opts.noSteps ? { then: "none" as const } : {}),
          ...(lander ? { lander } : {}),
        },
        `task: ${title}`,
        [...(owner ? [owner] : []), ...(review && review !== "*" ? [review] : [])],
        opts.re,
      );
    },
    oneLook,
  );

  readonly nameGoal = Effect.fn("AgentSession.nameGoal")(
    { self: this },
    function* (this: SessionTasks, ask: number, name: string | null) {
      const goal = name === null ? null : inlineText(name, 10_000);
      if (goal !== null && !goal) return yield* new Rejected('a goal needs a name: kiwi goal 18 "0.27.7: the AppImage runs on Fedora"');
      if (goal !== null && goal.length > MAX_GOAL_NAME) return yield* new Rejected(`a goal's name is at most ${MAX_GOAL_NAME} characters: say the outcome, the rest goes in the tasks`);
      const { state } = yield* this.state();
      if (!state.askHeads.has(ask)) return yield* new Rejected(`#${ask} isn't a person's message that tasks are filed under`);
      const seq = yield* this.event({ op: "ask.name", ask, name: goal }, goal ? `goal of #${ask}: ${goal}` : `#${ask}'s goal unnamed`);
      const after = yield* this.confirm(seq);
      return after.askHeads.get(ask)!;
    },
    oneLook,
  );

  readonly taskFromIssue = Effect.fn("AgentSession.taskFromIssue")(
    { self: this },
    function* (
      this: SessionTasks,
      ref: string,
      opts: { title?: string; detail?: string; owner?: string; review?: string; re?: number; from?: number; steps?: StepSpec[]; noSteps?: true; lander?: string } = {},
    ) {
      const { state } = yield* this.state();
      const issue = parseIssueRef(ref, state.repos);
      if (typeof issue === "string") return yield* new Rejected(issue);
      const name = `${issue.repo}#${issue.number}`;
      const already = taskOfIssue(state, issue);
      if (already) return yield* new Rejected(`${name} is already ${taskId(already.id)}: ${inlineText(already.title, 80)}`);
      const found = yield* this.ch.fx.githubIssue(issue.repo, issue.number);
      if (found.state === "closed") return yield* new Rejected(`${name} is closed on GitHub: reopen it first, or add the task without --issue`);
      const full = opts.title?.trim() || found.title.trim() || name;
      const title = opts.title?.trim() ? full : shortTitle(full);
      const cut = title !== full.replace(/\s+/g, " ").trim();
      const detail = opts.detail ?? [cut ? full : "", found.body.trim(), found.url].filter(Boolean).join("\n\n").slice(0, TASK_BODY_MAX_LENGTH);
      const id = yield* this.taskAdd(title, { ...opts, detail, issue });
      return { id, title, issue: name };
    },
    oneLook,
  );

  private reviewer(state: ChannelState, who: string): Effect.Effect<string, Rejected> {
    const w = who.trim();
    if (w === "*" || w.toLowerCase() === "any") return Effect.succeed("*");
    const m = state.members.get(w);
    if (!m?.active) return Effect.fail(new Rejected(`no member named ${w} to review it (or say any)`));
    return Effect.succeed(w);
  }

  readonly taskClaim = Effect.fn("AgentSession.taskClaim")(
    { self: this },
    function* (this: SessionTasks, id: number) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      if (t.state === "done") return yield* new Rejected(`${taskId(id)} is already done`);
      if (t.owner && t.owner !== this.me) return yield* new Rejected(`${taskId(id)} is owned by ${t.owner}`);
      const seq = yield* this.event({ op: "task.claim", task: id }, `claimed ${taskId(id)}`, undefined, undefined, { slot: { name: `task:${id}`, ttl: CLAIM_TTL } }).pipe(
        this.taken((who) => `${taskId(id)} is taken by ${who}`),
      );
      const after = yield* this.confirm(seq);
      return after;
    },
    oneLook,
  );

  readonly taskUpdate = Effect.fn("AgentSession.taskUpdate")(
    { self: this },
    function* (
      this: SessionTasks,
      id: number,
      change: {
        state?: TaskState | "cancelled";
        owner?: string | null;
        title?: string;
        detail?: string;
        note?: string;
        review?: string | null;
        claim?: true;
        verdict?: Verdict;
        at?: string;
        summary?: string;
        round?: number;
        runs?: number[];
        proof?: { url: string; label?: string };
        run?: { id: string };
        checkpoint?: true;
        lander?: string | null;
        close?: string;
        kept?: KeptEvidence;
      },
      reviewText?: string,
    ) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      const long = change.title === undefined ? null : titleRefusal(change.title);
      if (long) return yield* new Rejected(long);
      if (change.detail !== undefined && change.detail.length > TASK_BODY_MAX_LENGTH)
        return yield* new Rejected(`the body is ${change.detail.length} characters, the most a task's body takes is ${TASK_BODY_MAX_LENGTH}: link the rest`);
      if (change.summary !== undefined && (change.state !== "review" || !change.summary.trim())) return yield* new Rejected("a review summary needs text and a new review round");
      if (change.summary && change.summary.length > REVIEW_SUMMARY_MAX_LENGTH)
        return yield* new Rejected(`the review summary is ${change.summary.length} characters, the most it takes is ${REVIEW_SUMMARY_MAX_LENGTH}: keep what changed and how it was proven`);
      if (change.checkpoint && !change.note?.trim()) return yield* new Rejected("a checkpoint says where the work stands: give its text, or --file note.md");
      if (change.checkpoint && change.note && change.note.length > CHECKPOINT_MAX_LENGTH)
        return yield* new Rejected(`the checkpoint is ${change.note.length} characters, the most it takes is ${CHECKPOINT_MAX_LENGTH}: keep what a new session needs to carry on`);
      if (change.proof) {
        const { url, label } = change.proof;
        if (url.length > PROOF_URL_MAX_LENGTH || !/^https:\/\/[^\s]+$/.test(url))
          return yield* new Rejected(`proof is a link that starts with https:// (at most ${PROOF_URL_MAX_LENGTH} characters, no spaces)`);
        if (label !== undefined && (label.length > PROOF_LABEL_MAX_LENGTH || /[\r\n]/.test(label)))
          return yield* new Rejected(`the proof label is one line of at most ${PROOF_LABEL_MAX_LENGTH} characters`);
      }
      if (change.run && !wellFormedRunId(change.run.id)) return yield* new Rejected(`"${change.run.id}" isn't a run id: letters, digits and . _ : / @ + -, at most 200`);
      if (change.state && change.state !== "cancelled" && !TASK_STATES.includes(change.state)) return yield* new Rejected(`state must be one of ${TASK_STATES.join(", ")}`);
      const owner = change.owner ? (yield* this.resolveTo([change.owner], state))?.[0] : change.owner;
      const lander = change.lander ? (yield* this.resolveTo([change.lander], state))?.[0] : change.lander;
      const finishing = change.state === "done" || change.state === "cancelled";
      const reviewerLeft = !!t.review && t.review !== "*" && state.members.get(t.review)?.active === false;
      const opensReview = finishing && change.review === undefined && reviewerLeft && state.lead === this.me;
      const review = change.review ? yield* this.reviewer(state, change.review) : opensReview ? "*" : change.review;
      const me = state.members.get(this.me);
      const lead = !!me && (!!me.owner || me.persona?.role === "lead" || state.lead === this.me);
      if (change.detail !== undefined && me && !isPerson(me) && !lead) return yield* new Rejected(`only a person or the lead rewrites ${taskId(id)}'s body`);
      if (me) {
        const refused = change.claim ? reviewClaimRefusal(t, this.me, review) : reviewMoveRefusal(t, { name: this.me, person: isPerson(me), lead }, review);
        if (refused) return yield* new Rejected(refused);
        const unlanded = landingRefusal(t, change, { person: isPerson(me), lead });
        if (unlanded) return yield* new Rejected(unlanded);
      }
      const gate = review === undefined ? t.review : review || undefined;
      const notReviewer = !!gate && !!me && !isPerson(me) && (gate === "*" ? (owner ?? t.owner) === this.me || t.workedBy.includes(this.me) : gate !== this.me);
      const open = openRound(t);
      const revised = change.state === "cancelled" ? revisedOut(t, this.me, open) : null;
      if (finishing && change.close === undefined && t.state !== "done" && notReviewer && revised === null && !(lead && change.state === "cancelled")) {
        const what = change.state === "cancelled" ? "cancelled" : "done";
        if (gate === t.review && reviewerLeft)
          return yield* new Rejected(`${taskId(id)}'s reviewer ${gate} left the channel: the lead or a person opens its review (kiwi task review ${taskId(id)} --review any), then it can be ${what}`);
        if (open && change.state !== "cancelled")
          return yield* new Rejected(`${taskId(id)} needs review by ${gate === "*" ? "someone who hasn't worked on it" : gate} before it's done: ${reviewWaysOut(id, gate, open.n)}`);
        return yield* new Rejected(
          `${taskId(id)} needs review by ${gate === "*" ? "someone who hasn't worked on it" : gate} before it's ${what}: ${change.state === "cancelled" ? "ask a person or its reviewer to cancel it, or cancel it yourself once a review round has rejected it" : `send it for review (kiwi task review ${taskId(id)})`}`,
        );
      }
      if (change.verdict && notReviewer) return yield* new Rejected(`only ${gate === "*" ? "someone who hasn't worked on it" : gate} gives ${taskId(id)}'s verdict`);
      const judged = change.verdict && t.rounds.length ? yield* judgedRound(t, open, change.round, change.at) : null;
      const round = judged ? { round: judged.n, ...(judged.at ? { at: judged.at } : {}) } : revised !== null && notReviewer ? { round: revised } : {};
      const body = change.verdict && reviewText?.trim() ? { body: "review" as const } : {};
      const rest = omit(change, "round", "at", "lander");
      const opening = change.state === "review" && change.at?.trim() ? { at: change.at.trim() } : {};
      const worker = t.owner === this.me || t.workedBy.includes(this.me);
      const found = (change.state === "done" || change.state === "review") && worker && me && !isPerson(me) ? this.areasHere(id, state.branchPrefix) : null;
      const areas = found && found.join("\n") !== (t.areas ?? []).join("\n") ? { areas: found } : {};
      const notify: string[] = [];
      if (owner) notify.push(owner);
      if (t.owner && t.owner !== this.me) notify.push(t.owner);
      const reviewerName = (review ?? t.review) !== "*" ? (review ?? t.review) : undefined;
      if ((change.state === "review" || review) && reviewerName) notify.push(reviewerName);
      if (review !== undefined && t.review && t.review !== "*" && t.review !== reviewerName && !reviewerLeft) notify.push(t.review);
      if (finishing) notify.push(t.createdBy);
      const seq = yield* this.event(
        {
          op: "task.update",
          task: id,
          ...rest,
          ...opening,
          ...areas,
          ...(owner !== undefined ? { owner } : {}),
          ...(lander !== undefined ? { lander } : {}),
          ...(review !== undefined ? { review } : {}),
          ...round,
          ...body,
        },
        body.body ? (reviewText ?? "") : `${taskId(id)} ${change.verdict ?? change.state ?? "updated"}`,
        notify,
        undefined,
        t.owner === this.me && (owner !== undefined || finishing || change.state === "todo") ? { free: [`task:${id}`] } : {},
      );
      const after = yield* this.confirm(seq);
      const closed = after.tasks.get(id);
      if (finishing && t.state !== "done" && closed?.state === "done") {
        const { messages } = yield* this.state();
        yield* Effect.ignoreCause(this.send(taskDigest(after, messages, closed), { kind: "done", task: id }));
      }
      return after;
    },
    oneLook,
  );

  readonly handBack = Effect.fn("AgentSession.handBack")(
    { self: this },
    function* (this: SessionTasks) {
      const { state } = yield* this.state();
      const mine = heldBy(state, this.me);
      const reviewing = reviewedBy(state, this.me);
      if (!mine.length && !reviewing.length) return [];
      for (const t of reviewing) yield* this.taskUpdate(t.id, { review: "*" });
      const lead = state.lead && state.lead !== this.me ? [state.lead] : undefined;
      yield* this.send(handBackText(state, this.me, "left", mine, reviewing), lead ? { to: lead } : {});
      return [...mine, ...reviewing].map((t) => t.id);
    },
    oneLook,
  );

  readonly taskHandoff = Effect.fn("AgentSession.taskHandoff")(
    { self: this },
    function* (this: SessionTasks, id: number, to: string, next: string | undefined, first = false) {
      const { state } = yield* this.state();
      const target = (yield* this.resolveTo([to], state))?.[0];
      if (!target || !state.members.get(target)?.active) return yield* new Rejected(`no member named ${to}`);
      const task = state.tasks.get(id);
      if (target === this.me && !(task && !task.owner && task.leftBy)) return yield* new Rejected("hand it to someone else");
      const after = yield* this.taskUpdate(id, {
        owner: target,
        ...(next ? { note: next } : {}),
        ...(task?.state === "doing" ? { state: "todo" as const } : {}),
      });
      return first ? yield* this.taskFirst(id) : after;
    },
    oneLook,
  );

  private stepSpecs(state: ChannelState, specs: readonly StepSpec[]) {
    return Effect.forEach(specs, (spec) =>
      spec.by === undefined ? Effect.succeed(spec) : Effect.map(this.resolveTo([spec.by], state), (names): StepSpec => ({ ...spec, by: names?.[0] ?? spec.by })),
    );
  }

  readonly taskLanded = Effect.fn("AgentSession.taskLanded")(
    { self: this },
    function* (this: SessionTasks, id: number, said: { step?: string; link?: string; note?: string } = {}) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      if (!t.steps?.length) return yield* new Rejected(`${taskId(id)} has no landing steps: it finishes on approval`);
      const current = currentStep(t);
      const step = said.step ?? current?.id;
      if (step === undefined) return yield* new Rejected(`${taskId(id)} has no step left to end`);
      const wrong = landedStepRefusal(t, step);
      if (wrong) return yield* new Rejected(wrong);
      if (t.state !== "landing" && stepById(t, step)?.progress.kind === "open") return yield* new Rejected(`${taskId(id)} isn't approved and landing: it's ${t.state}`);
      const note = said.note?.trim();
      const seq = yield* this.event({ op: "task.landed", task: id, step, ...(said.link ? { link: said.link } : {}), ...(note ? { note } : {}) }, `${taskId(id)} step ${step} done`, [
        ...new Set([t.owner, t.lander, ...(t.steps ?? []).map((x) => x.by)].filter((n): n is string => !!n)),
      ]);
      return { state: yield* this.confirm(seq), step };
    },
    oneLook,
  );

  readonly taskSteps = Effect.fn("AgentSession.taskSteps")(
    { self: this },
    function* (this: SessionTasks, id: number, change: StepEdit) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      const edit: StepEdit =
        change.kind === "add"
          ? { ...change, step: (yield* this.stepSpecs(state, [change.step]))[0] ?? change.step }
          : change.kind === "by" && change.by
            ? { ...change, by: (yield* this.resolveTo([change.by], state))?.[0] ?? change.by }
            : change;
      const me = state.members.get(this.me);
      const lead = !!me && (!!me.owner || me.persona?.role === "lead" || state.lead === this.me);
      const refused = me ? stepEditRefusal(t, edit, { name: this.me, person: isPerson(me), lead }) : null;
      if (refused) return yield* new Rejected(refused);
      const about = edit.kind === "add" ? edit.step.words : stepText(stepById(t, edit.id) ?? { id: edit.id, words: "" });
      const seq = yield* this.event({ op: "task.steps", task: id, edit }, `${taskId(id)} steps: ${edit.kind} ${about}`, [
        ...new Set([t.owner, t.lander, edit.kind === "add" ? edit.step.by : edit.kind === "by" ? (edit.by ?? undefined) : stepById(t, edit.id)?.by].filter((n): n is string => !!n)),
      ]);
      return yield* this.confirm(seq);
    },
    oneLook,
  );

  readonly taskNudge = Effect.fn("AgentSession.taskNudge")({ self: this }, function* (this: SessionTasks, ev: Extract<Event, { op: "task.nudge" }>, to?: string) {
    return yield* this.event(ev, `${taskId(ev.task)} quiet`, to ? [to] : undefined);
  });

  readonly taskWake = Effect.fn("AgentSession.taskWake")({ self: this }, function* (this: SessionTasks, ev: Extract<Event, { op: "task.wake" }>) {
    return yield* this.event(ev, `${taskId(ev.task)} wake ${ev.got}`);
  });

  readonly taskFirst = Effect.fn("AgentSession.taskFirst")(
    { self: this },
    function* (this: SessionTasks, id: number) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      if (t.state === "done") return yield* new Rejected(`${taskId(id)} is already done`);
      if (!t.owner) return yield* new Rejected(`${taskId(id)} has no owner to go first for: assign it first`);
      const seq = yield* this.event({ op: "task.first", task: id }, `${taskId(id)} first`, t.owner !== this.me ? [t.owner] : undefined);
      return yield* this.confirm(seq);
    },
    oneLook,
  );

  readonly taskDelete = Effect.fn("AgentSession.taskDelete")(
    { self: this },
    function* (this: SessionTasks, id: number, why: string | undefined) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      const me = state.members.get(this.me);
      if (me && !isPerson(me) && state.lead !== this.me && me.persona?.role !== "lead") return yield* new Rejected(`only a person or the lead deletes ${taskId(id)}`);
      const notify = [...new Set([t.owner, t.createdBy].filter((n): n is string => !!n && n !== this.me))];
      const reason = why?.trim().slice(0, 500);
      const seq = yield* this.event({ op: "task.delete", task: id, ...(reason ? { why: reason } : {}) }, `deleted ${taskId(id)}`, notify.length ? notify : undefined);
      return yield* this.confirm(seq);
    },
    oneLook,
  );

  readonly endSpec = Effect.fn("AgentSession.endSpec")(
    { self: this },
    function* (this: SessionTasks, ask: number, how: "cancel" | "close" | "delete", why: string | undefined) {
      const { state } = yield* this.state();
      const spec = state.specs.get(ask);
      if (!spec) return yield* new Rejected(`#${ask} has no spec`);
      if (how !== "delete" && spec.result) return yield* new Rejected(`#${ask}'s spec is already ${spec.result.verdict}`);
      const note = why?.trim().slice(0, MAX_SPEC_NOTE);
      const owners = specTasks(state, ask)
        .filter((t) => t.state !== "done" && !t.archived)
        .flatMap((t) => (t.owner && t.owner !== this.me ? [t.owner] : []));
      const notify = how === "close" ? undefined : [...new Set(owners)];
      const ev =
        how === "delete"
          ? ({ op: "spec.delete", ask, ...(note ? { why: note } : {}) } as const)
          : ({ op: "spec.result", ask, verdict: how === "close" ? "accepted" : "dropped", ...(note ? { note } : {}) } as const);
      const said = how === "delete" ? `deleted #${ask}'s spec` : how === "close" ? `closed #${ask}'s spec` : `cancelled #${ask}'s spec`;
      const seq = yield* this.event(ev, said, notify?.length ? notify : undefined);
      return yield* this.confirm(seq);
    },
    oneLook,
  );

  readonly writeSpec = Effect.fn("AgentSession.writeSpec")(
    { self: this },
    function* (this: SessionTasks, ask: number, text: string) {
      const body = text.trim();
      if (!body) return yield* new Rejected("a spec needs words: what it's for, when it's done, what's in and out");
      if (body.length > MAX_SPEC) return yield* new Rejected(`the spec is ${body.length} characters, the most a spec takes is ${MAX_SPEC}: link the rest`);
      const { state } = yield* this.state();
      if (!state.askHeads.has(ask)) return yield* new Rejected(`#${ask} isn't a person's message, so no spec is written for it`);
      const was = state.specs.get(ask);
      if (was?.result) return yield* new Rejected(`#${ask}'s spec is ${was.result.verdict}, so it no longer changes`);
      if (was && was.text.trim() === body) return was;
      const seq = yield* this.event({ op: "spec.set", ask, text: body }, `spec of #${ask}`);
      const after = yield* this.confirm(seq);
      return after.specs.get(ask)!;
    },
    oneLook,
  );

  readonly readySpec = Effect.fn("AgentSession.readySpec")(
    { self: this },
    function* (this: SessionTasks, ask: number) {
      const { state } = yield* this.state();
      const spec = state.specs.get(ask);
      if (!spec) return yield* new Rejected(`#${ask} has no spec`);
      if (spec.ready?.v === spec.v) return spec;
      const seq = yield* this.event({ op: "spec.ready", ask, v: spec.v }, `spec of #${ask} ready for approval`);
      const after = yield* this.confirm(seq);
      return after.specs.get(ask)!;
    },
    oneLook,
  );

  readonly tickSpec = Effect.fn("AgentSession.tickSpec")(
    { self: this },
    function* (this: SessionTasks, ask: number, words: string, done: boolean) {
      const { state } = yield* this.state();
      const spec = state.specs.get(ask);
      if (!spec) return yield* new Rejected(`#${ask} has no spec`);
      const ticked = tickDoneWhen(spec.text, words, done);
      if ("why" in ticked) return yield* new Rejected(ticked.why);
      return yield* this.writeSpec(ask, ticked.text);
    },
    oneLook,
  );

  readonly startSpec = Effect.fn("AgentSession.startSpec")(
    { self: this },
    function* (this: SessionTasks, ask: number, ttlSec: number) {
      const { state } = yield* this.state();
      const spec: Spec | undefined = state.specs.get(ask);
      if (!spec) return yield* new Rejected(`#${ask} has no spec`);
      const stage = specStage(state, spec);
      if (stage === "draft") return yield* new Rejected(`#${ask}'s spec isn't approved yet: comment on it, or wait for a person to approve it`);
      if (stage !== "queued") return yield* new Rejected(`#${ask}'s spec is ${stage}, so there's nothing to start: kiwi spec show ${ask}`);
      const lease: Lease = yield* this.lease(specLease(ask), ttlSec, `planning #${ask}`);
      return { spec, lease };
    },
    oneLook,
  );

  readonly commentSpec = Effect.fn("AgentSession.commentSpec")(
    { self: this },
    function* (this: SessionTasks, ask: number, text: string, on?: string) {
      const { state } = yield* this.state();
      if (!state.specs.has(ask)) return yield* new Rejected(`#${ask} has no spec to comment on`);
      const quote = on?.trim();
      const body = quote
        ? `${quote
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")}\n\n${text.trim()}`
        : text.trim();
      return yield* this.reply(ask, body);
    },
    oneLook,
  );
}
