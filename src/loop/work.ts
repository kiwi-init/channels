import { inlineText } from "@kiwi/core/membership.ts";
import { reentryText } from "@kiwi/core/reentry.ts";
import { openRound, taskId, type ChannelState, type Task } from "@kiwi/core/state.ts";

export type Work = { kind: "coding"; task: number } | { kind: "reviewing"; task: number; round: number } | { kind: "answering" };

const live = (t: Task | undefined): t is Task => !!t && t.state !== "done" && !t.archived;

const openTasks = (state: ChannelState) => [...state.tasks.values()].filter(live).sort((a, b) => a.id - b.id);

const awaitingVerdict = (t: Task) => !!openRound(t);

function owedReview(state: ChannelState, me: string): Work | null {
  for (const t of openTasks(state)) {
    const round = openRound(t);
    if (round && t.review === me && t.owner !== me) return { kind: "reviewing", task: t.id, round: round.n };
  }
  return null;
}

export function nextWork(state: ChannelState, me: string, unreadForMe: number): Work | null {
  const mine = openTasks(state).filter((t) => t.owner === me);
  const doing = mine.find((t) => t.state === "doing" && !awaitingVerdict(t));
  if (doing) return { kind: "coding", task: doing.id };
  const review = owedReview(state, me);
  if (review) return review;
  const coding = mine.find((t) => !awaitingVerdict(t)) ?? mine[0];
  if (coding) return { kind: "coding", task: coding.id };
  return unreadForMe > 0 ? { kind: "answering" } : null;
}

export function workOver(work: Work, state: ChannelState, me: string): boolean {
  switch (work.kind) {
    case "coding": {
      const t = state.tasks.get(work.task);
      return !live(t) || t.owner !== me || (awaitingVerdict(t) && owedReview(state, me) !== null);
    }
    case "reviewing": {
      const t = state.tasks.get(work.task);
      return !live(t) || t.review !== me || openRound(t)?.n !== work.round;
    }
    case "answering":
      return false;
    default: {
      const never: never = work;
      return never;
    }
  }
}

export function workName(work: Work): string {
  switch (work.kind) {
    case "coding":
      return `${taskId(work.task)}`;
    case "reviewing":
      return `${taskId(work.task)} round ${work.round}`;
    case "answering":
      return "messages";
    default: {
      const never: never = work;
      return never;
    }
  }
}

function focus(work: Work, state: ChannelState, mc: string): string {
  switch (work.kind) {
    case "coding": {
      const t = state.tasks.get(work.task);
      const id = taskId(work.task);
      const title = t ? ` “${inlineText(t.title, 160)}”` : "";
      const finish = t?.review
        ? `When the work is ready, send it for review with \`${mc} task review ${id} --at SHA\` (the commit it's at), then wait here for the verdict: on a rejection, fix what it says and send a new round. The session ends when the review approves ${id}, or sooner if a review you owe comes up while you wait (a rejection then gets a fresh session).`
        : `When it's finished, mark it with \`${mc} task done ${id}\`. The session ends then.`;
      return `This session is for ${id}${title}, which you own. Start it with \`${mc} task show ${id}\` and \`${mc} task start ${id}\` if it isn't doing yet. Answer messages for you as they come; only other tasks and reviews wait for their own session. ${finish}`;
    }
    case "reviewing": {
      const id = taskId(work.task);
      return `This session is for reviewing round ${work.round} of ${id}. Read it with \`${mc} task show ${id}\`, check the work at the round's commit, and give your verdict with \`${mc} task approve ${id} --round ${work.round} "note"\` or \`${mc} task reject ${id} --round ${work.round} "what to fix"\`. The session ends when the round closes.`;
    }
    case "answering":
      return `This session is for messages waiting on you. Read them with \`${mc} listen --now\` and answer each one. The session ends when you're idle with nothing unread; if you take on a task, it stays open for that task until it's done.`;
    default: {
      const never: never = work;
      return never;
    }
  }
}

export function firstPrompt(work: Work, state: ChannelState, me: string, alias: string, now = Date.now(), mc = "kiwi"): string {
  const reentry = reentryText(state, me, now, undefined, mc);
  return [`You're ${me} in the Kiwi Channels channel "${alias}", started by your seat's loop in a fresh session.`, focus(work, state, mc), ...(reentry ? [reentry] : [])].join("\n\n");
}
