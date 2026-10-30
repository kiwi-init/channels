import { inlineText } from "@kiwi/core/membership.ts";
import { reentryText } from "@kiwi/core/reentry.ts";
import { openRound, taskId, type ChannelState, type Task } from "@kiwi/core/state.ts";

export type Work = { kind: "coding"; task: number } | { kind: "reviewing"; task: number; round: number } | { kind: "answering" };

const live = (t: Task | undefined): t is Task => !!t && t.state !== "done" && !t.archived;

const openTasks = (state: ChannelState) => [...state.tasks.values()].filter(live).sort((a, b) => a.id - b.id);

const awaitingVerdict = (t: Task) => !!openRound(t);

const owesReview = (t: Task, me: string) => t.owner !== me && (t.review === me || (t.review === "*" && !t.workedBy.includes(me)));

function owedReview(state: ChannelState, me: string, setAside: ReadonlySet<string> = new Set()): Work | null {
  for (const t of openTasks(state)) {
    const round = openRound(t);
    const work: Work | null = round ? { kind: "reviewing", task: t.id, round: round.n } : null;
    if (work && owesReview(t, me) && !(t.review === "*" && setAside.has(workName(work)))) return work;
  }
  return null;
}

export function nextWork(state: ChannelState, me: string, unreadForMe: number, setAside: ReadonlySet<string> = new Set()): Work | null {
  const mine = openTasks(state).filter((t) => t.owner === me);
  const first = mine.filter((t) => t.first !== undefined && !awaitingVerdict(t)).sort((a, b) => (b.first ?? 0) - (a.first ?? 0))[0];
  if (first) return { kind: "coding", task: first.id };
  const doing = mine.find((t) => t.state === "doing" && !awaitingVerdict(t));
  if (doing) return { kind: "coding", task: doing.id };
  const review = owedReview(state, me, setAside);
  if (review) return review;
  const coding = mine.find((t) => !awaitingVerdict(t)) ?? mine[0];
  if (coding) return { kind: "coding", task: coding.id };
  return unreadForMe > 0 ? { kind: "answering" } : null;
}

export function waitingBehind(work: Work, state: ChannelState, me: string, setAside: ReadonlySet<string> = new Set()): Work[] {
  const held = work.kind === "answering" ? null : work.task;
  const open = openTasks(state).filter((t) => t.id !== held);
  const reviews = open.flatMap((t): Work[] => {
    const round = openRound(t);
    const review: Work | null = round ? { kind: "reviewing", task: t.id, round: round.n } : null;
    return review && owesReview(t, me) && !(t.review === "*" && setAside.has(workName(review))) ? [review] : [];
  });
  if (work.kind === "answering") return reviews;
  const coding = open.filter((t) => t.owner === me && !awaitingVerdict(t)).map((t): Work => ({ kind: "coding", task: t.id }));
  return [...coding, ...reviews];
}

export type Wait = { since: number; tellAt: number | null };

export function waitsDue(waits: Map<string, Wait>, behind: readonly Work[], now: number, tellAfter: number): { fresh: Work[]; due: Work[] } {
  const names = new Set(behind.map(workName));
  for (const name of [...waits.keys()]) if (!names.has(name)) waits.delete(name);
  const fresh: Work[] = [];
  const due: Work[] = [];
  for (const w of behind) {
    const wait = waits.get(workName(w));
    if (!wait) {
      waits.set(workName(w), { since: now, tellAt: now + tellAfter });
      fresh.push(w);
    } else if (wait.tellAt !== null && now >= wait.tellAt) due.push(w);
  }
  return { fresh, due };
}

export function waitTellsTo(state: ChannelState, me: string): string[] {
  if (state.lead && state.lead !== me && state.members.get(state.lead)?.active) return [state.lead];
  return [...state.members.values()].filter((m) => m.owner && m.active && m.name !== me).map((m) => m.name);
}

export function waitingText(waiting: Work, session: Work, minutes: number, mc = "kiwi"): string {
  const held = session.kind === "answering" ? "messages" : taskId(session.task);
  const free =
    session.kind === "coding"
      ? `approve it, mark it done, or hand it on with \`${mc} task assign ${held} NAME\``
      : session.kind === "reviewing"
        ? `give round ${session.round}'s verdict or move its review to someone else`
        : "answer what's waiting";
  return `${workName(waiting)} has waited ${minutes} minutes behind my ${workName(session)} session, which is still running: my loop starts it only when that work is over. To start ${workName(waiting)} now, ${free}.`;
}

export function workOver(work: Work, state: ChannelState, me: string, setAside: ReadonlySet<string> = new Set()): boolean {
  switch (work.kind) {
    case "coding": {
      const t = state.tasks.get(work.task);
      return !live(t) || t.owner !== me || (awaitingVerdict(t) && owedReview(state, me, setAside) !== null);
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

export type Step = { kind: "keep"; work: Work } | { kind: "over" } | { kind: "fresh"; work: Work; why: "took" | "checkpoint" };

export function step(work: Work, state: ChannelState, me: string, freshFor: number | null, setAside: ReadonlySet<string> = new Set()): Step {
  if (work.kind === "answering") {
    const taken = nextWork(state, me, 0, setAside);
    return taken?.kind === "coding" ? { kind: "fresh", work: taken, why: "took" } : { kind: "keep", work };
  }
  if (workOver(work, state, me, setAside)) return { kind: "over" };
  if (work.kind === "coding" && freshFor === work.task) return { kind: "fresh", work, why: "checkpoint" };
  return { kind: "keep", work };
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

function focus(work: Work, state: ChannelState, me: string, mc: string): string {
  switch (work.kind) {
    case "coding": {
      const t = state.tasks.get(work.task);
      const id = taskId(work.task);
      const title = t ? ` “${inlineText(t.title, 160)}”` : "";
      const head = `This session is for ${id}${title}, which you own. Answer messages for you as they come; only other tasks and reviews wait for their own session.`;
      const send = `write where it stands with \`${mc} task checkpoint ${id} --file note.md\`, then send it for review with \`${mc} task review ${id} --at SHA\` (the commit it's at)`;
      const selfReviewed = t?.review === me ? ` You're also its reviewer, so nobody else will give its verdict: ask the lead or a person to name another reviewer.` : "";
      const round = t ? openRound(t) : undefined;
      if (t?.review && round)
        return `${head} Its round ${round.n} is with ${inlineText(t.review, 40)}: wait here for the verdict, and don't run \`${mc} task start ${id}\`, which would withdraw that round. On a rejection, fix what it says, ${send}. The session ends when the review approves ${id}, or sooner if a review you owe comes up while you wait (a rejection then gets a fresh session).${selfReviewed}`;
      const finish = t?.review
        ? `When the work is ready, ${send}, then wait here for the verdict: on a rejection, fix what it says and send a new round the same way. The session ends when the review approves ${id}, or sooner if a review you owe comes up while you wait (a rejection then gets a fresh session).${selfReviewed}`
        : `When it's finished, mark it with \`${mc} task done ${id}\`. The session ends then.`;
      const fresh = ` If this session grows long, save where it stands with \`${mc} task checkpoint ${id} --fresh --file note.md\` and end your turn: a fresh session picks ${id} up from that checkpoint.`;
      return `${head} Start with \`${mc} task show ${id}\`, and \`${mc} task start ${id}\` if it isn't doing yet. ${finish}${fresh}`;
    }
    case "reviewing": {
      const id = taskId(work.task);
      return `This session is for reviewing round ${work.round} of ${id}. Read it with \`${mc} task show ${id}\`, check the work at the round's commit, and give your verdict with \`${mc} task approve ${id} --round ${work.round} "note"\` or \`${mc} task reject ${id} --round ${work.round} "what to fix"\`. Answer messages for you as they come; your own tasks wait for their own session, even if one of them is rejected meanwhile. The session ends when the round closes.`;
    }
    case "answering":
      return `This session is for messages waiting on you. Read them with \`${mc} listen --now --for-me\`. Reply only to a message that asks you something or needs something from you; react with 👍 (\`${mc} react N 👍\`) to one you've only noted, and never post an acknowledgement or thanks. The session ends when you're idle with nothing unread; if you take on a task, end your turn once it's yours, and a fresh session starts for it.`;
    default: {
      const never: never = work;
      return never;
    }
  }
}

export function firstPrompt(work: Work, state: ChannelState, me: string, alias: string, now = Date.now(), mc = "kiwi"): string {
  const reentry = reentryText(state, me, now, undefined, mc);
  return [`You're ${me} in the Kiwi Channels channel "${alias}", started by your seat's loop in a fresh session.`, focus(work, state, me, mc), ...(reentry ? [reentry] : [])].join("\n\n");
}
