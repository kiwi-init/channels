// The Work view (T1150): what each agent is doing, what changed, what needs a person, and each
// task's whole story as one feed. Everything is read from the folded state and the log every
// client already holds; nothing new crosses the relay. What a person may not see in strict
// coordinator-only mode (an agent's chat with another agent) stays out of every part of it.

import { cleanBody, describeEvent, reviewBody, roundTag } from "./format.ts";
import { inlineText } from "./membership.ts";
import { ignored, type Message } from "./protocol.ts";
import type { OldTaskState, TaskState } from "./protocol.ts";
import { currentState, isPerson, keptFromPeople, type ChannelState, type Task } from "./state.ts";

/** Quiet this long, with nothing in progress, and an agent reads as idle. */
const IDLE_AFTER_MS = 15 * 60_000;

/**
 * Whether `viewer` may see message `m` here: nothing forged or refused, and for a person in
 * strict coordinator-only mode, no agent's chat except the coordinator's. Events always show.
 */
function visibleTo(state: ChannelState, viewer: string, m: Message): boolean {
  if (ignored(state.trust.get(m.seq))) return false;
  const me = state.members.get(viewer);
  return !(me && isPerson(me) && keptFromPeople(state, m));
}

// ---------- pull requests ----------

export interface PrRef {
  url: string;
  repo: string;
  number: number;
  /** Open until a later message or note says it was merged (or closed). No call to GitHub is made. */
  state: "open" | "merged" | "closed";
  /** The message that first linked it. */
  seq: number;
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/** The pull request links in a piece of text, each once. */
export function prLinks(text: string): { url: string; repo: string; number: number }[] {
  const seen = new Map<string, { url: string; repo: string; number: number }>();
  for (const m of text.matchAll(PR_URL)) seen.set(m[0], { url: m[0], repo: m[1]!, number: Number(m[2]) });
  return [...seen.values()];
}

/** What a message says about a PR's fate: its URL (or "#N" next to the word) with "merged" or "closed". */
function fateIn(text: string, pr: { url: string; number: number }): "merged" | "closed" | null {
  const near = (word: string) =>
    (text.includes(pr.url) && new RegExp(`\\b${word}\\b`, "i").test(text)) ||
    new RegExp(`\\b${word}\\b[^.\\n]{0,40}#${pr.number}\\b|#${pr.number}\\b[^.\\n]{0,40}\\b${word}\\b`, "i").test(text);
  return near("merged") ? "merged" : near("closed") ? "closed" : null;
}

/** The text a message carries for links: its body, or a task note. */
const textOf = (m: Message): string => (m.ev?.op === "task.update" ? (m.ev.note ?? "") : m.kind === "event" ? "" : m.body);

/** PRs linked in these messages, with what later messages (any visible one) say happened to them. */
export function prsIn(state: ChannelState, messages: Message[], viewer: string, linkedBy: (m: Message) => boolean): PrRef[] {
  const prs = new Map<string, PrRef>();
  for (const m of messages) {
    if (!visibleTo(state, viewer, m)) continue;
    const text = textOf(m);
    if (!text) continue;
    if (linkedBy(m)) for (const l of prLinks(text)) if (!prs.has(l.url)) prs.set(l.url, { ...l, state: "open", seq: m.seq });
    for (const pr of prs.values()) {
      if (m.seq <= pr.seq) continue;
      const fate = fateIn(text, pr);
      if (fate) pr.state = fate;
    }
  }
  return [...prs.values()];
}

export interface RecentPr extends PrRef {
  by: string;
  last: number;
  task?: number;
}

function taskOf(state: ChannelState, m: Message, text: string): number | undefined {
  if (m.ev?.op === "task.update") return m.ev.task;
  if (m.task !== undefined) return m.task;
  for (const hit of text.matchAll(/\bT(\d+)\b/g)) {
    const id = Number(hit[1]);
    if (state.tasks.has(id)) return id;
  }
  return undefined;
}

export function recentPrs(state: ChannelState, messages: Message[], viewer: string, limit: number): RecentPr[] {
  const seen = new Map<string, { by: string; last: number; task?: number }>();
  for (const m of messages) {
    if (!visibleTo(state, viewer, m)) continue;
    const text = textOf(m);
    if (!text) continue;
    for (const l of prLinks(text)) {
      const task = seen.get(l.url)?.task ?? taskOf(state, m, text);
      seen.set(l.url, { by: m.from, last: at(m), ...(task !== undefined ? { task } : {}) });
    }
  }
  return prsIn(state, messages, viewer, () => true)
    .flatMap((pr) => {
      const s = seen.get(pr.url);
      return s ? [{ ...pr, ...s }] : [];
    })
    .sort((a, b) => b.last - a.last)
    .slice(0, limit);
}

// ---------- agents ----------

type AgentStatus = "working" | "blocked" | "idle" | "offline";

export interface AgentRow {
  name: string;
  role?: string;
  /** Their first task in progress. */
  doing?: Task;
  /** What they last said about their work, from what this viewer may see (a status message, a task note, else their latest message). */
  statusLine?: { text: string; seq: number; at: number };
  status: AgentStatus;
  /** Since when they've been blocked or idle (for "Blocked 20 min"). */
  since: number;
  prs: PrRef[];
  lastActive: number;
  online: boolean;
}

const at = (m: Message) => m.rts ?? m.ts;

/** One row per agent in the channel: what it's doing, its status line, and whether it's working, blocked, idle or away. */
export function agentRows(state: ChannelState, messages: Message[], viewer: string, online: Set<string>, now = Date.now()): AgentRow[] {
  const agents = [...state.members.values()].filter((m) => m.active && !isPerson(m));
  return agents
    .map((a): AgentRow => {
      const mine = [...state.tasks.values()].filter((t) => t.owner === a.name).sort((x, y) => x.id - y.id);
      const doing = mine.find((t) => t.state === "doing");
      const blockingAsk = state.openAsks.find((m) => m.from === a.name && m.kind === "blocking" && visibleTo(state, viewer, m));
      const said = [...messages].reverse().filter((m) => m.from === a.name && visibleTo(state, viewer, m));
      const line =
        said.find((m) => m.kind === "status") ?? said.find((m) => m.ev?.op === "task.update" && !!m.ev.note) ?? said.find((m) => m.kind !== "event");
      const statusLine = line ? { text: inlineText(textOf(line), 140), seq: line.seq, at: at(line) } : undefined;
      const lastActive = a.lastSeen;
      const status: AgentStatus = blockingAsk ? "blocked" : doing ? "working" : online.has(a.name) ? "idle" : now - lastActive < IDLE_AFTER_MS ? "idle" : "offline";
      const since = status === "blocked" && blockingAsk ? at(blockingAsk) : lastActive;
      return {
        name: a.name,
        ...(a.role ? { role: a.role } : {}),
        ...(doing ? { doing } : {}),
        ...(statusLine?.text ? { statusLine } : {}),
        status,
        since,
        prs: prsIn(state, messages, viewer, (m) => m.from === a.name).filter((p) => p.state === "open"),
        lastActive,
        online: online.has(a.name),
      };
    })
    .sort((x, y) => RANK[x.status] - RANK[y.status] || y.lastActive - x.lastActive);
}
const RANK: Record<AgentStatus, number> = { blocked: 0, working: 1, idle: 2, offline: 3 };

// ---------- what changed, what needs a person ----------

export interface Need {
  seq: number;
  at: number;
  from: string;
  text: string;
  kind: "ask" | "blocking";
}

/**
 * Open questions waiting on a person: asks and blockers addressed to people (or to everyone), and
 * in coordinator-only mode the coordinator's open asks, which is how a question reaches people there.
 */
export function needsPerson(state: ChannelState, viewer: string): Need[] {
  const people = new Set([...state.members.values()].filter((m) => m.active && isPerson(m)).map((m) => m.name));
  return state.openAsks
    .filter((m) => visibleTo(state, viewer, m) && !people.has(m.from))
    .filter((m) => !m.to?.length || m.to.some((t) => people.has(t) || t === "*") || (state.mode.coordinatorOnly && m.from === state.coordinator))
    .map((m) => ({ seq: m.seq, at: at(m), from: m.from, text: inlineText(m.body, 140), kind: m.kind === "blocking" ? ("blocking" as const) : ("ask" as const) }))
    .reverse();
}

// ---------- a task's feed ----------

/** What a feed row's mark shows: a task state, or what kind of change it was. */
export type EventMark = TaskState | "add" | "assign" | "note" | "other";

/** One item of an activity feed: an event as a single row, or a thread as one card. */
export type FeedItem =
  | { type: "event"; seq: number; at: number; actor: string; text: string; op: string; mark: EventMark; note?: string; review?: string }
  | { type: "pr"; seq: number; at: number; actor: string; pr: PrRef }
  | { type: "thread"; seq: number; at: number; root: number; room?: string; messages: Message[] };

/** Whether a message names task `id` ("T12"). */
function mentions(m: Message, id: number): boolean {
  return new RegExp(`\\bT${id}\\b`).test(textOf(m));
}

/**
 * Everything about one task, in log order: its own events (made, claimed, updated, noted), every
 * thread that mentions it (whole, as one card, in any room), and the pull requests linked there.
 */
export function taskFeed(state: ChannelState, messages: Message[], id: number, viewer: string): FeedItem[] {
  const items: FeedItem[] = [];
  const threads = new Map<number, Message[]>();
  const mentioning = new Set<number>();
  for (const m of messages) {
    if (!visibleTo(state, viewer, m)) continue;
    const ev = m.ev;
    if (m.kind === "event") {
      const own = ev && ((ev.op === "task.add" && m.seq === id) || ("task" in ev && ev.task === id));
      if (own && !state.rejected.has(m.seq)) items.push({ type: "event", seq: m.seq, at: at(m), actor: m.from, op: ev!.op, ...onTask(m, state) });
      continue;
    }
    const root = state.threadOf.get(m.seq) ?? m.seq;
    let thread = threads.get(root);
    if (!thread) threads.set(root, (thread = []));
    thread.push(m);
    if (mentions(m, id)) mentioning.add(root);
  }
  for (const root of mentioning) {
    const thread = threads.get(root)!;
    const first = thread[0]!;
    const room = state.roomOf.get(first.seq);
    items.push({ type: "thread", seq: first.seq, at: at(first), root, ...(room ? { room } : {}), messages: thread });
  }
  const linked = (m: Message) => (m.ev?.op === "task.update" && m.ev.task === id) || (m.kind !== "event" && mentioning.has(state.threadOf.get(m.seq) ?? m.seq));
  for (const pr of prsIn(state, messages, viewer, linked)) {
    const m = messages.find((x) => x.seq === pr.seq)!;
    items.push({ type: "pr", seq: pr.seq, at: at(m), actor: m.from, pr });
  }
  return items.sort((a, b) => a.seq - b.seq || (a.type === "pr" ? 1 : 0) - (b.type === "pr" ? 1 : 0));
}

const VERB: Record<TaskState | OldTaskState, string> = {
  todo: "reopened it",
  doing: "started it",
  review: "sent it for review",
  done: "finished it",
  // Older clients' states.
  blocked: "marked it blocked",
  cancelled: "cancelled it",
};

/** A task's own event, told from the task's page: "started it", "assigned it to ann", "created the task". */
function onTask(m: Message, state: ChannelState): { text: string; mark: EventMark; note?: string; review?: string } {
  const ev = m.ev!;
  const review = reviewBody(m);
  const note = { ...(ev.op === "task.update" && ev.note ? { note: inlineText(ev.note, 2000) } : {}), ...(review ? { review: cleanBody(review) } : {}) };
  const round = ev.op === "task.update" ? roundTag(state.tasks.get(ev.task), m.seq, ev.round) : "";
  switch (ev.op) {
    case "task.add":
      return { text: ev.owner ? `created the task for ${ev.owner}` : "created the task", mark: "add" };
    case "task.claim":
      return { text: "took it", mark: "assign" };
    case "task.update":
      if (ev.owner && (!ev.state || ev.state === "todo")) return { text: `assigned it to ${ev.owner}`, mark: "assign", ...note };
      if (ev.state === "doing" && ev.verdict === "rejected") return { text: `rejected it${round}`, mark: currentState(ev.state), ...note };
      if (ev.state === "done" && ev.verdict === "approved") return { text: `approved it${round}`, mark: currentState(ev.state), ...note };
      if (ev.state === "review") return { text: `${VERB.review}${round}`, mark: currentState(ev.state), ...note };
      if (ev.state) return { text: VERB[ev.state], mark: currentState(ev.state), ...note };
      if (ev.owner) return { text: `assigned it to ${ev.owner}`, mark: "assign", ...note };
      if (ev.owner === null) return { text: "unassigned it", mark: "assign", ...note };
      if (ev.title) return { text: `renamed it to “${inlineText(ev.title, 200)}”`, mark: "other", ...note };
      return { text: "added a note", mark: "note", ...note };
    default:
      return { text: describeEvent(m, state), mark: "other" };
  }
}

/** The pull requests a task's feed links, for the task page's side panel. */
export function taskPrs(items: FeedItem[]): PrRef[] {
  return items.flatMap((i) => (i.type === "pr" ? [i.pr] : []));
}
