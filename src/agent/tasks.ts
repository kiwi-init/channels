import * as Effect from "effect/Effect";
import {
  CHECKPOINT_MAX_LENGTH,
  MAX_GOAL_NAME,
  PROOF_LABEL_MAX_LENGTH,
  PROOF_URL_MAX_LENGTH,
  REVIEW_SUMMARY_MAX_LENGTH,
  TASK_STATES,
  TASK_BODY_MAX_LENGTH,
  TASK_TITLE_LIMIT,
  ignored,
  type IssueRef,
  type TaskState,
  type Verdict,
} from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { isPerson, openRound, reviewClaimRefusal, reviewMoveRefusal, revisedOut, taskId, type ChannelState, type ReviewRound, type Task } from "@kiwi/core/state.ts";
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
    function* (this: SessionTasks, title: string, opts: { detail?: string; owner?: string; review?: string; re?: number; issue?: IssueRef; from?: number } = {}) {
      const long = titleRefusal(title);
      if (long) return yield* new Rejected(long);
      if (opts.detail && opts.detail.length > TASK_BODY_MAX_LENGTH)
        return yield* new Rejected(`the body is ${opts.detail.length} characters, the most a task's body takes is ${TASK_BODY_MAX_LENGTH}: link the rest (a doc, an issue) instead`);
      const { state } = yield* this.state();
      if (opts.re !== undefined && (!state.placeOf.has(opts.re) || ignored(state.trust.get(opts.re)))) return yield* new Rejected(`no message #${opts.re}`);
      if (opts.from !== undefined && !state.tasks.has(opts.from)) return yield* new Rejected(`no task ${taskId(opts.from)} to come from`);
      const owner = opts.owner && (yield* this.resolveTo([opts.owner], state))?.[0];
      const review = opts.review === undefined ? undefined : yield* this.reviewer(state, opts.review);
      return yield* this.event(
        {
          op: "task.add",
          title,
          ...(opts.detail ? { detail: opts.detail } : {}),
          ...(owner ? { owner } : {}),
          ...(review ? { review } : {}),
          ...(opts.issue ? { issue: opts.issue } : {}),
          ...(opts.from !== undefined ? { from: opts.from } : {}),
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
    function* (this: SessionTasks, ref: string, opts: { title?: string; detail?: string; owner?: string; review?: string; re?: number; from?: number } = {}) {
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
        note?: string;
        review?: string | null;
        claim?: true;
        verdict?: Verdict;
        at?: string;
        summary?: string;
        round?: number;
        proof?: { url: string; label?: string };
        checkpoint?: true;
      },
      reviewText?: string,
    ) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      const long = change.title === undefined ? null : titleRefusal(change.title);
      if (long) return yield* new Rejected(long);
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
      if (change.state && change.state !== "cancelled" && !TASK_STATES.includes(change.state)) return yield* new Rejected(`state must be one of ${TASK_STATES.join(", ")}`);
      const owner = change.owner ? (yield* this.resolveTo([change.owner], state))?.[0] : change.owner;
      const finishing = change.state === "done" || change.state === "cancelled";
      const reviewerLeft = !!t.review && t.review !== "*" && state.members.get(t.review)?.active === false;
      const opensReview = finishing && change.review === undefined && reviewerLeft && state.lead === this.me;
      const review = change.review ? yield* this.reviewer(state, change.review) : opensReview ? "*" : change.review;
      const me = state.members.get(this.me);
      if (me) {
        const lead = !!me.owner || me.persona?.role === "lead" || state.lead === this.me;
        const refused = change.claim ? reviewClaimRefusal(t, this.me, review) : reviewMoveRefusal(t, { name: this.me, person: isPerson(me), lead }, review);
        if (refused) return yield* new Rejected(refused);
      }
      const gate = review === undefined ? t.review : review || undefined;
      const notReviewer = !!gate && !!me && !isPerson(me) && (gate === "*" ? (owner ?? t.owner) === this.me || t.workedBy.includes(this.me) : gate !== this.me);
      const open = openRound(t);
      const revised = change.state === "cancelled" ? revisedOut(t, this.me, open) : null;
      if (finishing && t.state !== "done" && notReviewer && revised === null) {
        const what = change.state === "cancelled" ? "cancelled" : "done";
        if (gate === t.review && reviewerLeft)
          return yield* new Rejected(`${taskId(id)}'s reviewer ${gate} left the channel: the lead or a person opens its review (kiwi task review ${taskId(id)} --review any), then it can be ${what}`);
        return yield* new Rejected(
          `${taskId(id)} needs review by ${gate === "*" ? "someone who hasn't worked on it" : gate} before it's ${what}: ${change.state === "cancelled" ? "ask a person or its reviewer to cancel it, or cancel it yourself once a review round has rejected it" : `send it for review (kiwi task review ${taskId(id)})`}`,
        );
      }
      if (change.verdict && notReviewer) return yield* new Rejected(`only ${gate === "*" ? "someone who hasn't worked on it" : gate} gives ${taskId(id)}'s verdict`);
      const judged = change.verdict && t.rounds.length ? yield* judgedRound(t, open, change.round, change.at) : null;
      const round = judged ? { round: judged.n, ...(judged.at ? { at: judged.at } : {}) } : revised !== null && notReviewer ? { round: revised } : {};
      const body = change.verdict && reviewText?.trim() ? { body: "review" as const } : {};
      const rest = omit(change, "round", "at");
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
        { op: "task.update", task: id, ...rest, ...opening, ...areas, ...(owner !== undefined ? { owner } : {}), ...(review !== undefined ? { review } : {}), ...round, ...body },
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
      if (target === this.me) return yield* new Rejected("hand it to someone else");
      const after = yield* this.taskUpdate(id, {
        owner: target,
        ...(next ? { note: next } : {}),
        ...(state.tasks.get(id)?.state === "doing" ? { state: "todo" as const } : {}),
      });
      return first ? yield* this.taskFirst(id) : after;
    },
    oneLook,
  );

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
}
