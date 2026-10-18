// The Work view (T1150): what each agent is doing, what changed, what needs a person, and each
// task's whole story as one feed. Everything is read from the folded state and the log every
// client already holds; nothing new crosses the relay. What a person may not see in strict
// coordinator-only mode (an agent's chat with another agent) stays out of every part of it.

import { cleanBody, describeEvent, proofLabel, reviewBody, roundTag } from "./format.ts";
import type { ReviewCheck } from "./client/github.ts";
import { inlineText } from "./membership.ts";
import { ignored, type IssueRef, type Message } from "./protocol.ts";
import type { OldTaskState, TaskState } from "./protocol.ts";
import { currentState, isPerson, issueOf, prChecks, prKey, taskId, type ChannelState, type GithubPr, type Task } from "./state.ts";

/** Quiet this long, with nothing in progress, and an agent reads as idle. */
const IDLE_AFTER_MS = 15 * 60_000;

export function visible(state: ChannelState, m: Message): boolean {
  return !ignored(state.trust.get(m.seq));
}

// ---------- pull requests ----------

export interface PrRef {
  url: string;
  repo: string;
  number: number;
  /** GitHub's word when the channel's GitHub events have it; else open until a later message or note says it was merged (or closed). */
  state: "open" | "merged" | "closed";
  /** The message that first linked it. */
  seq: number;
  title?: string;
  branch?: string;
  checks?: PrChecks;
}

export interface PrChecks {
  passed: number;
  failed: string[];
  running: number;
}

export const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

function checksOf(state: ChannelState, pr: GithubPr): PrChecks | undefined {
  const runs = prChecks(state.github, pr);
  if (!runs.length) return undefined;
  const failed = runs.filter((r) => r.conclusion && FAILED.has(r.conclusion)).map((r) => r.name);
  const running = runs.filter((r) => !r.conclusion).length;
  return { passed: runs.length - failed.length - running, failed, running };
}

function fromGithub(state: ChannelState, pr: PrRef): PrRef {
  const real = state.github.prs.get(prKey(pr.repo, pr.number));
  if (!real) return pr;
  const checks = checksOf(state, real);
  return { ...pr, state: real.state, ...(real.title ? { title: real.title } : {}), ...(real.branch ? { branch: real.branch } : {}), ...(checks ? { checks } : {}) };
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
    (text.includes(pr.url) && new RegExp(`\\b${word}\\b`, "i").test(text)) || new RegExp(`\\b${word}\\b[^.\\n]{0,40}#${pr.number}\\b|#${pr.number}\\b[^.\\n]{0,40}\\b${word}\\b`, "i").test(text);
  return near("merged") ? "merged" : near("closed") ? "closed" : null;
}

/** The text a message carries for links: its body, or a task note. */
export const textOf = (m: Message): string => (m.ev?.op === "task.update" ? (m.ev.note ?? "") : m.kind === "event" ? "" : m.body);

/** PRs linked in these messages, with what later messages (any visible one) say happened to them. */
export function prsIn(state: ChannelState, messages: Message[], linkedBy: (m: Message) => boolean): PrRef[] {
  const prs = new Map<string, PrRef>();
  for (const m of messages) {
    if (!visible(state, m)) continue;
    const text = textOf(m);
    if (!text) continue;
    if (linkedBy(m)) for (const l of prLinks(text)) if (!prs.has(l.url)) prs.set(l.url, { ...l, state: "open", seq: m.seq });
    for (const pr of prs.values()) {
      if (m.seq <= pr.seq) continue;
      const fate = fateIn(text, pr);
      if (fate) pr.state = fate;
    }
  }
  return [...prs.values()].map((pr) => fromGithub(state, pr));
}

export interface RecentPr extends PrRef {
  by: string;
  last: number;
  task?: number;
}

function taskOf(state: ChannelState, m: Message, text: string): number | undefined {
  for (const hit of text.matchAll(/\bT(\d+)\b/g)) {
    const id = Number(hit[1]);
    if (state.tasks.has(id)) return id;
  }
  if (m.ev?.op === "task.update") return m.ev.task;
  const place = state.placeOf.get(m.seq);
  return m.task ?? (place?.kind === "task" ? place.task : undefined);
}

export function recentPrs(state: ChannelState, messages: Message[], limit: number): RecentPr[] {
  const seen = new Map<string, { by: string; last: number; task?: number }>();
  for (const m of messages) {
    if (!visible(state, m)) continue;
    const text = textOf(m);
    if (!text) continue;
    for (const l of prLinks(text)) {
      const task = seen.get(l.url)?.task ?? taskOf(state, m, text);
      seen.set(l.url, { by: m.from, last: at(m), ...(task !== undefined ? { task } : {}) });
    }
  }
  return prsIn(state, messages, () => true)
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
  /** What they last said about their work, from what they said (a status message, a task note, else their latest message). */
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
export function agentRows(state: ChannelState, messages: Message[], online: Set<string>, now = Date.now()): AgentRow[] {
  const agents = [...state.members.values()].filter((m) => m.active && !isPerson(m));
  return agents
    .map((a): AgentRow => {
      const mine = [...state.tasks.values()].filter((t) => t.owner === a.name).sort((x, y) => x.id - y.id);
      const doing = mine.find((t) => t.state === "doing");
      const blockingAsk = state.openAsks.find((m) => m.from === a.name && m.kind === "blocking" && visible(state, m));
      const said = [...messages].reverse().filter((m) => m.from === a.name && visible(state, m));
      const line = said.find((m) => m.kind === "status") ?? said.find((m) => m.ev?.op === "task.update" && !!m.ev.note) ?? said.find((m) => m.kind !== "event");
      const statusLine = line ? { text: inlineText(textOf(line), 140), seq: line.seq, at: at(line) } : undefined;
      const lastActive = a.lastSeen;
      const status: AgentStatus = blockingAsk ? "blocked" : doing ? "working" : online.has(a.name) ? "idle" : now - lastActive < IDLE_AFTER_MS ? "idle" : "offline";
      const since = status === "blocked" && blockingAsk ? at(blockingAsk) : lastActive;
      return {
        name: a.name,
        ...(a.persona ? { role: a.persona?.name } : {}),
        ...(doing ? { doing } : {}),
        ...(statusLine?.text ? { statusLine } : {}),
        status,
        since,
        prs: prsIn(state, messages, (m) => m.from === a.name).filter((p) => p.state === "open"),
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

/** Open questions waiting on a person: asks and blockers addressed to people, or to everyone. */
export function needsPerson(state: ChannelState): Need[] {
  const people = new Set([...state.members.values()].filter((m) => m.active && isPerson(m)).map((m) => m.name));
  return state.openAsks
    .filter((m) => visible(state, m) && !people.has(m.from))
    .filter((m) => !m.to?.length || m.to.some((t) => people.has(t) || t === "*"))
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

export function taskPr(state: ChannelState, id: number): { pr: GithubPr; checks?: PrChecks } | undefined {
  const rank = (p: GithubPr) => (p.state === "open" ? 1 : 0);
  const pr = [...state.github.prs.values()].filter((p) => taskOfBranch(p.branch) === id).sort((a, b) => rank(b) - rank(a) || b.at - a.at)[0];
  if (!pr) return undefined;
  const checks = checksOf(state, pr);
  return checks ? { pr, checks } : { pr };
}

export function taskOfBranch(branch: string | undefined): number | null {
  const m = branch && /^(?:[\w.-]+\/)?T(\d{1,9})(?:$|[-_/.])/i.exec(branch);
  return m ? Number(m[1]) : null;
}

/** Whether a message names task `id` ("T12"). */
function mentions(m: Message, id: number): boolean {
  return new RegExp(`\\bT${id}\\b`).test(textOf(m));
}

/**
 * Everything about one task, in log order: its own events (made, claimed, updated, noted), every
 * thread that mentions it (whole, as one card, in any room), and the pull requests linked there.
 */
export function taskFeed(state: ChannelState, messages: Message[], id: number): FeedItem[] {
  const items: FeedItem[] = [];
  const threads = new Map<number, Message[]>();
  const mentioning = new Set<number>();
  for (const m of messages) {
    if (!visible(state, m)) continue;
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
  const shown = new Set<string>();
  for (const pr of prsIn(state, messages, linked)) {
    const m = messages.find((x) => x.seq === pr.seq)!;
    shown.add(prKey(pr.repo, pr.number));
    items.push({ type: "pr", seq: pr.seq, at: at(m), actor: m.from, pr });
  }
  for (const [key, gh] of state.github.prs) {
    if (shown.has(key) || taskOfBranch(gh.branch) !== id) continue;
    const m = messages.find((x) => x.seq === gh.seq);
    if (!m) continue;
    const pr = fromGithub(state, { url: gh.url ?? `https://github.com/${gh.repo}/pull/${gh.number}`, repo: gh.repo, number: gh.number, state: gh.state, seq: gh.seq });
    items.push({ type: "pr", seq: gh.seq, at: at(m), actor: m.from, pr });
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
      if (ev.proof) return { text: `added proof: ${inlineText(proofLabel(ev.proof), 80)}`, mark: "note", ...note };
      return { text: "added a note", mark: "note", ...note };
    default:
      return { text: describeEvent(m, state), mark: "other" };
  }
}

/** The pull requests a task's feed links, for the task page's side panel. */
export function taskPrs(items: FeedItem[]): PrRef[] {
  return items.flatMap((i) => (i.type === "pr" ? [i.pr] : []));
}

export function taskDigest(state: ChannelState, messages: Message[], t: Task): string {
  const feed = taskFeed(state, messages, t.id);
  const prs = [...new Map(taskPrs(feed).map((p) => [p.url, `${p.repo}#${p.number}`])).values()];
  const said = feed.reduce((n, i) => n + (i.type === "thread" ? i.messages.length : 0), 0);
  const note = [...t.notes].reverse().find((n) => n.text.trim().toLowerCase() !== "approved")?.text;
  const by = [...new Set([...t.workedBy, ...(t.owner ? [t.owner] : [])])];
  return [
    `${taskId(t.id)} ${t.cancelled ? "cancelled" : "done"}: ${inlineText(t.title, 120)}`,
    ...(note ? [inlineText(note, 240)] : []),
    ...(prs.length ? [`PR ${prs.join(", ")}`] : []),
    ...(by.length ? [`by ${by.join(", ")}`] : []),
    ...(t.approvedBy && !t.cancelled ? [`approved by ${t.approvedBy}`] : []),
    ...(said ? [`${said} message${said === 1 ? "" : "s"} in its threads`] : []),
  ].join(" · ");
}

export function taskRepo(state: ChannelState, messages: Message[], id: number): string | null {
  const pr = taskPrs(taskFeed(state, messages, id))[0];
  return pr ? pr.repo.toLowerCase() : state.repos.length === 1 ? state.repos[0]!.toLowerCase() : null;
}

export function verdictsAfter(state: ChannelState, messages: Message[], after: number): (ReviewCheck & { seq: number })[] {
  const out: (ReviewCheck & { seq: number })[] = [];
  for (const t of state.tasks.values()) {
    for (const r of t.rounds) {
      if (!r.at || (r.result.kind !== "approved" && r.result.kind !== "rejected") || r.result.seq <= after) continue;
      const repo = taskRepo(state, messages, t.id);
      if (!repo) continue;
      const seq = r.result.seq;
      const note = t.notes.find((n) => n.seq === seq)?.text;
      out.push({ repo, sha: r.at, verdict: r.result.kind, task: t.id, seq, ...(note ? { note } : {}) });
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export function prsToLinkBack(state: ChannelState, after: number): { repo: string; number: number; task: number; seq: number; body: string }[] {
  const out: { repo: string; number: number; task: number; seq: number; body: string }[] = [];
  for (const pr of state.github.prs.values()) {
    const id = taskOfBranch(pr.branch);
    const t = id === null ? undefined : state.tasks.get(id);
    if (!t || pr.seq <= after || pr.state !== "open") continue;
    out.push({ repo: pr.repo, number: pr.number, task: t.id, seq: pr.seq, body: `Kiwi task ${taskId(t.id)}: ${inlineText(t.title, 200)}` });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export interface IssueClose {
  repo: string;
  number: number;
  task: number;
  seq: number;
  reason: "completed" | "not_planned";
  body: string;
}

export function issuesToClose(state: ChannelState, after: number): IssueClose[] {
  const out: IssueClose[] = [];
  for (const t of state.tasks.values()) {
    if (!t.issue || t.state !== "done" || !t.closedSeq || t.closedSeq <= after || issueOf(state.github, t.issue)?.state === "closed") continue;
    const note = t.notes.find((n) => n.seq === t.closedSeq)?.text;
    const said = note && note !== "cancelled" ? `: ${inlineText(note, 500)}` : "";
    out.push({
      repo: t.issue.repo,
      number: t.issue.number,
      task: t.id,
      seq: t.closedSeq,
      reason: t.cancelled ? "not_planned" : "completed",
      body: `Kiwi task ${taskId(t.id)} ${t.cancelled ? "cancelled" : "done"}${said}`,
    });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export interface TaskClose {
  task: number;
  seq: number;
  cancelled: boolean;
  note: string;
}

export function tasksClosedOnGithub(state: ChannelState, after: number): TaskClose[] {
  const out: TaskClose[] = [];
  for (const t of state.tasks.values()) {
    const issue = t.issue && issueOf(state.github, t.issue);
    if (!issue || issue.state !== "closed" || issue.seq <= after || t.state === "done") continue;
    const how = issue.reason === "not_planned" ? "closed as not planned" : "closed";
    out.push({ task: t.id, seq: issue.seq, cancelled: issue.reason === "not_planned", note: `${issue.repo}#${issue.number} ${how} on GitHub${issue.by ? ` by @${issue.by}` : ""}` });
  }
  return out.sort((a, b) => a.seq - b.seq || a.task - b.task);
}

export function taskOfIssue(state: ChannelState, ref: IssueRef): Task | undefined {
  const key = prKey(ref.repo, ref.number);
  return [...state.tasks.values()].find((t) => t.issue && t.state !== "done" && prKey(t.issue.repo, t.issue.number) === key);
}

export function parseIssueRef(s: string, repos: readonly string[]): IssueRef | string {
  const t = s.trim();
  const url = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d{1,9})\/?(?:[?#].*)?$/i.exec(t);
  const named = /^([^/\s#]+\/[^/\s#]+)#(\d{1,9})$/.exec(t);
  const bare = /^#?(\d{1,9})$/.exec(t);
  const repo = url?.[1] ?? named?.[1] ?? (bare ? (repos.length === 1 ? repos[0] : null) : undefined);
  const number = Number(url?.[2] ?? named?.[2] ?? bare?.[1]);
  if (repo === undefined) return `"${t}" isn't an issue: say 12, owner/repo#12 or its GitHub link`;
  if (repo === null)
    return repos.length ? `say which repo: ${repos.map((r) => `${r}#${number}`).join(" or ")}` : "the channel has no repo connected: the owner connects one in the app's GitHub settings";
  const known = repos.find((r) => r.toLowerCase() === repo.toLowerCase());
  if (!known) return `${repo} isn't one of the channel's repos${repos.length ? ` (${repos.join(", ")})` : ""}`;
  if (!number) return `"${t}" has no issue number`;
  return { repo: known, number };
}
