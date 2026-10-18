import * as Effect from "effect/Effect";
import { TASK_STATES, TASK_TITLE_MAX_LENGTH, ignored, type TaskState, type Verdict } from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { isPerson, openRound, revisedOut, taskId, type ChannelState, type ReviewRound, type Task } from "@kiwi/core/state.ts";
import { SessionMessaging } from "./messaging.ts";
import { oneLook } from "./shared.ts";

const CLAIM_TTL = 120_000;

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
  readonly taskAdd = Effect.fn("AgentSession.taskAdd")(
    { self: this },
    function* (this: SessionTasks, title: string, opts: { detail?: string; owner?: string; review?: string; re?: number } = {}) {
      if (title.length > TASK_TITLE_MAX_LENGTH)
        return yield* new Rejected(`the title is ${title.length} characters, the most a task takes is ${TASK_TITLE_MAX_LENGTH}: shorten it and put the rest in --detail`);
      const { state } = yield* this.state();
      if (opts.re !== undefined && (!state.placeOf.has(opts.re) || ignored(state.trust.get(opts.re)))) return yield* new Rejected(`no message #${opts.re}`);
      const owner = opts.owner && (yield* this.resolveTo([opts.owner], state))?.[0];
      const review = opts.review === undefined ? undefined : yield* this.reviewer(state, opts.review);
      return yield* this.event(
        {
          op: "task.add",
          title,
          ...(opts.detail ? { detail: opts.detail } : {}),
          ...(owner ? { owner } : {}),
          ...(review ? { review } : {}),
        },
        `task: ${title}`,
        [...(owner ? [owner] : []), ...(review && review !== "*" ? [review] : [])],
        opts.re,
      );
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
      change: { state?: TaskState | "cancelled"; owner?: string | null; title?: string; note?: string; review?: string | null; verdict?: Verdict; at?: string; round?: number },
      reviewText?: string,
    ) {
      const { state } = yield* this.state();
      const t = state.tasks.get(id);
      if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
      if (change.title !== undefined && change.title.length > TASK_TITLE_MAX_LENGTH)
        return yield* new Rejected(`the title is ${change.title.length} characters, the most a task takes is ${TASK_TITLE_MAX_LENGTH}: shorten it and put the rest in a note`);
      if (change.state && change.state !== "cancelled" && !TASK_STATES.includes(change.state)) return yield* new Rejected(`state must be one of ${TASK_STATES.join(", ")}`);
      const owner = change.owner ? (yield* this.resolveTo([change.owner], state))?.[0] : change.owner;
      const review = change.review ? yield* this.reviewer(state, change.review) : change.review;
      const me = state.members.get(this.me);
      const gate = review === undefined ? t.review : review || undefined;
      const finishing = change.state === "done" || change.state === "cancelled";
      const notReviewer = !!gate && !!me && !isPerson(me) && (gate === "*" ? (owner ?? t.owner) === this.me || t.workedBy.includes(this.me) : gate !== this.me);
      const open = openRound(t);
      const revised = change.state === "cancelled" ? revisedOut(t, this.me, open) : null;
      if (finishing && t.state !== "done" && notReviewer && revised === null) {
        const what = change.state === "cancelled" ? "cancelled" : "done";
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
      const notify: string[] = [];
      if (owner) notify.push(owner);
      if (t.owner && t.owner !== this.me) notify.push(t.owner);
      const reviewerName = (review ?? t.review) !== "*" ? (review ?? t.review) : undefined;
      if ((change.state === "review" || review) && reviewerName) notify.push(reviewerName);
      if (finishing) notify.push(t.createdBy);
      const seq = yield* this.event(
        { op: "task.update", task: id, ...rest, ...opening, ...(owner !== undefined ? { owner } : {}), ...(review !== undefined ? { review } : {}), ...round, ...body },
        body.body ? (reviewText ?? "") : `${taskId(id)} ${change.verdict ?? change.state ?? "updated"}`,
        notify,
        undefined,
        t.owner === this.me && (owner !== undefined || finishing || change.state === "todo") ? { free: [`task:${id}`] } : {},
      );
      const after = yield* this.confirm(seq);
      return after;
    },
    oneLook,
  );

  readonly taskHandoff = Effect.fn("AgentSession.taskHandoff")(
    { self: this },
    function* (this: SessionTasks, id: number, to: string, next: string | undefined) {
      const { state } = yield* this.state();
      const target = (yield* this.resolveTo([to], state))?.[0];
      if (!target || !state.members.get(target)?.active) return yield* new Rejected(`no member named ${to}`);
      if (target === this.me) return yield* new Rejected("hand it to someone else");
      return yield* this.taskUpdate(id, { owner: target, ...(next ? { note: next } : {}), ...(state.tasks.get(id)?.state === "doing" ? { state: "todo" as const } : {}) });
    },
    oneLook,
  );
}
