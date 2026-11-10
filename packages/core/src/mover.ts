import { inlineText } from "./membership.ts";
import { landerOf, openRound, type ChannelState, type Task } from "./state.ts";

type MoveFor = "work" | "start" | "assign" | "review" | "route" | "revise" | "answer" | "land";

export type Mover = { kind: "member"; name: string; move: MoveFor; question?: number } | { kind: "waiting"; owner: string; ahead: number } | { kind: "nobody"; move: MoveFor };

type Board = Pick<ChannelState, "tasks" | "members" | "lead" | "openAsks">;

const here = (state: Board, name: string | undefined | null): name is string => !!name && state.members.get(name)?.active === true;

function channelOwner(state: Board): string | undefined {
  return [...state.members.values()].find((m) => m.owner && m.active)?.name;
}

function settle(state: Board, name: string | undefined | null, move: MoveFor, question?: number): Mover {
  const who = here(state, name) ? name : channelOwner(state);
  return who ? { kind: "member", name: who, move, ...(question !== undefined ? { question } : {}) } : { kind: "nobody", move };
}

const leadOr = (state: Board, name: string | undefined, move: MoveFor, unowned: MoveFor): Mover => (name ? settle(state, name, move) : settle(state, state.lead, unowned));

function heldBy(state: Board, t: Task): Mover | undefined {
  const oldest = state.openAsks.filter((m) => m.holds?.includes(t.id)).sort((a, b) => a.seq - b.seq)[0];
  return oldest ? settle(state, oldest.to?.[0], "answer", oldest.seq) : undefined;
}

function queued(state: Board, t: Task, owner: string): Mover {
  const theirs = [...state.tasks.values()].filter((x) => x.owner === owner && !x.archived);
  const ahead = theirs.filter((x) => x.state === "doing" || (x.state === "todo" && x.id < t.id)).length;
  return ahead ? { kind: "waiting", owner, ahead } : settle(state, owner, "start");
}

const landingMover = (state: Board, t: Task): Mover => leadOr(state, landerOf(t), "land", "assign");

export function moverOf(state: Board, t: Task): Mover | undefined {
  if (t.state === "done" || t.archived) return undefined;
  const held = heldBy(state, t);
  if (held) return held;
  if (t.state === "doing") return leadOr(state, t.owner, "work", "assign");
  if (t.state === "todo") return t.owner && here(state, t.owner) ? queued(state, t, t.owner) : leadOr(state, t.owner, "start", "assign");
  if (t.state === "landing") return landingMover(state, t);
  if (!openRound(t)) return leadOr(state, t.owner, "revise", "assign");
  return t.review && t.review !== "*" ? settle(state, t.review, "review") : settle(state, state.lead, "route");
}

const MOVE_WORDS: Record<MoveFor, string> = {
  work: "to work on it",
  start: "to start it",
  assign: "to give it an owner",
  review: "to review it",
  route: "to give it a reviewer",
  revise: "to send it for review again",
  answer: "to answer",
  land: "to land it",
};

export function moverText(m: Mover): string {
  if (m.kind === "waiting") return `waiting, ${m.ahead} ahead of it for ${inlineText(m.owner, 40)}`;
  if (m.kind === "nobody") return `nobody ${MOVE_WORDS[m.move]}: the channel has no owner here`;
  return `${inlineText(m.name, 40)} ${MOVE_WORDS[m.move]}${m.question !== undefined ? ` #${m.question}` : ""}`;
}

export function moverTag(t: Pick<Task, "owner">, m: Mover | undefined): string {
  if (!m) return "";
  if (m.kind === "waiting") return ` · waiting, ${m.ahead} ahead`;
  if (m.kind === "nobody" || m.move === "assign") return "";
  return m.name === t.owner && m.move !== "revise" ? "" : ` · move: ${inlineText(m.name, 40)} ${MOVE_WORDS[m.move]}${m.question !== undefined ? ` #${m.question}` : ""}`;
}
